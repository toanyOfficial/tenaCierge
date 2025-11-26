#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""클리너 랭킹/점수 업데이트 배치."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import os
from typing import Dict, Iterable, List, Optional, Sequence

import mysql.connector
import requests

KST = dt.timezone(dt.timedelta(hours=9))


def configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="클리너 랭킹 업데이트 배치")
    parser.add_argument(
        "--target-date",
        type=lambda s: dt.datetime.strptime(s, "%Y-%m-%d").date(),
        default=dt.datetime.now(KST).date(),
        help="업데이트 기준 일자 (기본: 오늘)",
    )
    return parser.parse_args()


def get_db_connection() -> mysql.connector.MySQLConnection:
    cfg = dict(
        host=os.environ.get("DB_HOST", "127.0.0.1"),
        port=int(os.environ.get("DB_PORT", 3306)),
        user=os.environ.get("DB_USER", "root"),
        password=os.environ.get("DB_PASSWORD", ""),
        database=os.environ.get("DB_NAME", "tenaCierge"),
        autocommit=False,
    )
    logging.info("DB 접속 정보: %s:%s/%s", cfg["host"], cfg["port"], cfg["database"])
    return mysql.connector.connect(**cfg)


class CleanerRankingBatch:
    def __init__(self, conn, target_date: dt.date) -> None:
        self.conn = conn
        self.target_date = target_date
        self.openai_api_key = os.environ.get("OPENAI_API_KEY")

    def run(self) -> None:
        scores = self._fetch_scores()
        workers = self._load_workers(scores)
        if not workers:
            logging.info("worker_header 인원이 없어 종료합니다.")
            return
        tier_rules = self._load_tier_rules()
        if not tier_rules:
            logging.warning("worker_tier_rules 테이블이 비어 있어 tier 계산을 건너뜁니다.")
            return
        daily_evals = self._load_daily_evaluations()
        comments = self._generate_comments(daily_evals)
        if comments:
            self._persist_comments(comments, daily_evals)
        tier_updates = self._calculate_tiers(workers, tier_rules)
        self._persist_tiers(tier_updates)
        self.conn.commit()

    def _fetch_scores(self) -> Dict[int, float]:
        start_date = self.target_date - dt.timedelta(days=19)
        start_dt = dt.datetime.combine(start_date, dt.time.min)
        end_dt = dt.datetime.combine(self.target_date + dt.timedelta(days=1), dt.time.min)
        sql = """
            SELECT worker_id, COALESCE(SUM(checklist_point_sum), 0) AS total
            FROM worker_evaluateHistory
            WHERE evaluate_dttm >= %s
              AND evaluate_dttm < %s
            GROUP BY worker_id
        """
        scores: Dict[int, float] = {}
        with self.conn.cursor(dictionary=True) as cur:
            cur.execute(sql, (start_dt, end_dt))
            for row in cur:
                scores[row["worker_id"]] = float(row["total"] or 0)
        logging.info(
            "%s ~ %s 점수 수집: %s명",
            start_dt.date(),
            (end_dt - dt.timedelta(days=1)).date(),
            len(scores),
        )
        return scores

    def _load_workers(self, scores: Dict[int, float]) -> List[Dict[str, Optional[float]]]:
        with self.conn.cursor(dictionary=True) as cur:
            cur.execute("SELECT id, tier FROM worker_header")
            workers: List[Dict[str, Optional[float]]] = []
            for row in cur:
                wid = row["id"]
                row["score"] = float(scores.get(wid, 0.0))
                workers.append(row)
        return workers

    def _load_daily_evaluations(self) -> Dict[int, List[Dict[str, object]]]:
        start_dt = dt.datetime.combine(self.target_date, dt.time.min)
        end_dt = start_dt + dt.timedelta(days=1)
        sql = """
            SELECT id, worker_id, checklist_title_array, checklist_point_sum, evaluate_dttm
            FROM worker_evaluateHistory
            WHERE evaluate_dttm >= %s AND evaluate_dttm < %s
        """
        evaluations: Dict[int, List[Dict[str, object]]] = {}
        with self.conn.cursor(dictionary=True) as cur:
            cur.execute(sql, (start_dt, end_dt))
            for row in cur:
                worker_id = int(row["worker_id"])
                checklist = row.get("checklist_title_array")
                try:
                    checklist_list: Iterable[int] = json.loads(checklist) if checklist else []
                except Exception:
                    checklist_list = []
                entry = dict(
                    id=int(row["id"]),
                    points=int(row.get("checklist_point_sum") or 0),
                    checklist_ids=list(checklist_list),
                    evaluate_dttm=row.get("evaluate_dttm"),
                )
                evaluations.setdefault(worker_id, []).append(entry)
        logging.info("%s 일자 평가 건수: %s명", self.target_date, len(evaluations))
        return evaluations

    def _load_tier_rules(self) -> List[Dict[str, int]]:
        sql = """
            SELECT min_percentage, max_percentage, tier
            FROM worker_tier_rules
            ORDER BY min_percentage ASC
        """
        with self.conn.cursor(dictionary=True) as cur:
            cur.execute(sql)
            return [
                dict(
                    min_percentage=int(row["min_percentage"]),
                    max_percentage=int(row["max_percentage"]),
                    tier=int(row["tier"]),
                )
                for row in cur
            ]

    def _calculate_tiers(
        self,
        workers: Sequence[Dict[str, Optional[float]]],
        tier_rules: Sequence[Dict[str, int]],
    ) -> Dict[int, int]:
        assigned: Dict[int, int] = {}
        population = [w for w in workers if w["tier"] != 1]
        population.sort(key=lambda w: w["score"], reverse=True)
        n = len(population)
        if not n:
            return assigned
        for idx, worker in enumerate(population):
            percentile = ((idx + 1) / n) * 100
            rule = next(
                (
                    r
                    for r in tier_rules
                    if percentile > r["min_percentage"] and percentile <= r["max_percentage"]
                ),
                None,
            )
            if rule:
                assigned[worker["id"]] = rule["tier"]
        return assigned

    def _build_prompt(self, worker_id: int, entries: List[Dict[str, object]]) -> str:
        scores = [int(e["points"]) for e in entries]
        total_score = sum(scores)
        avg_score = total_score / len(scores) if scores else 0
        checklist_counts = [len(e.get("checklist_ids", [])) for e in entries]
        avg_checks = sum(checklist_counts) / len(checklist_counts) if checklist_counts else 0
        return (
            f"클리너 ID {worker_id}의 {self.target_date} 업무 요약입니다. "
            f"총 작업 {len(entries)}건, 점수 합계 {total_score}점, 평균 점수 {avg_score:.1f}점, "
            f"작업당 평균 체크 항목 수 {avg_checks:.1f}개입니다. "
            "체크리스트 항목 이름이나 세부 ID는 그대로 언급하지 말고, 청소/점검 품질과 개선점, "
            "다음 근무 시 유의사항을 2문장 이내 한국어로 230자 이하로 작성하세요. "
            "구체적 체크리스트명을 피하고, 긍정과 개선을 함께 제시하세요."
        )

    def _generate_comments(self, evaluations: Dict[int, List[Dict[str, object]]]) -> Dict[int, str]:
        if not self.openai_api_key:
            logging.warning("OPENAI_API_KEY가 없어 코멘트 생성을 건너뜁니다.")
            return {}
        comments: Dict[int, str] = {}
        for worker_id, entries in evaluations.items():
            if not entries:
                continue
            prompt = self._build_prompt(worker_id, entries)
            try:
                resp = requests.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.openai_api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": "gpt-4o-mini",
                        "messages": [
                            {
                                "role": "system",
                                "content": "숙소 청소 성과를 요약하는 평가자입니다. 결과는 한국어로만 답하세요.",
                            },
                            {"role": "user", "content": prompt},
                        ],
                        "max_tokens": 200,
                        "temperature": 0.6,
                    },
                    timeout=15,
                )
                resp.raise_for_status()
                data = resp.json()
                message = data["choices"][0]["message"]["content"].strip()
                comments[worker_id] = message[:255]
                logging.info("worker %s 코멘트 생성 완료", worker_id)
            except Exception as exc:  # pylint: disable=broad-except
                logging.warning("worker %s 코멘트 생성 실패: %s", worker_id, exc)
        return comments

    def _persist_comments(
        self, comments: Dict[int, str], evaluations: Dict[int, List[Dict[str, object]]]
    ) -> None:
        if not comments:
            return
        with self.conn.cursor() as cur:
            for worker_id, comment in comments.items():
                entries = evaluations.get(worker_id, [])
                if not entries:
                    continue
                latest_entry = max(
                    entries,
                    key=lambda e: (
                        e.get("evaluate_dttm") or dt.datetime.min,
                        e.get("id", 0),
                    ),
                )
                sql = "UPDATE worker_evaluateHistory SET comment=%s WHERE id=%s"
                cur.execute(sql, (comment, latest_entry["id"]))
        logging.info("AI 코멘트 업데이트 %s명", len(comments))

    def _persist_tiers(self, updates: Dict[int, int]) -> None:
        if not updates:
            logging.info("tier 갱신 대상 없음")
            return
        with self.conn.cursor() as cur:
            for worker_id, tier in updates.items():
                cur.execute(
                    "UPDATE worker_header SET tier=%s WHERE id=%s",
                    (tier, worker_id),
                )
        logging.info("tier 업데이트 %s건", len(updates))


def main() -> None:
    configure_logging()
    args = parse_args()
    conn = get_db_connection()
    try:
        CleanerRankingBatch(conn, args.target_date).run()
    finally:
        conn.close()


if __name__ == "__main__":
    main()
