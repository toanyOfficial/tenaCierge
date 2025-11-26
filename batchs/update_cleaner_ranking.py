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
        checklist_titles = self._load_checklist_titles()
        daily_trend = self._load_daily_trend_scores()
        daily_evals = self._load_daily_evaluations(checklist_titles)
        comments = self._generate_comments(daily_evals, daily_trend)
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

    def _load_checklist_titles(self) -> Dict[int, str]:
        sql = "SELECT id, title FROM work_checklist_list"
        titles: Dict[int, str] = {}
        with self.conn.cursor(dictionary=True) as cur:
            cur.execute(sql)
            for row in cur:
                titles[int(row["id"])] = row.get("title") or ""
        return titles

    def _load_daily_trend_scores(self) -> Dict[int, List[Dict[str, object]]]:
        start_date = self.target_date - dt.timedelta(days=6)
        start_dt = dt.datetime.combine(start_date, dt.time.min)
        end_dt = dt.datetime.combine(self.target_date + dt.timedelta(days=1), dt.time.min)
        sql = """
            SELECT worker_id, DATE(evaluate_dttm) AS eval_date, SUM(checklist_point_sum) AS total
            FROM worker_evaluateHistory
            WHERE evaluate_dttm >= %s AND evaluate_dttm < %s
            GROUP BY worker_id, eval_date
        """
        trend: Dict[int, List[Dict[str, object]]] = {}
        with self.conn.cursor(dictionary=True) as cur:
            cur.execute(sql, (start_dt, end_dt))
            for row in cur:
                worker_id = int(row["worker_id"])
                trend.setdefault(worker_id, []).append(
                    {
                        "date": str(row["eval_date"]),
                        "score": int(row.get("total") or 0),
                    }
                )
        return trend

    def _extract_checklist_ids_from_reports(self, contents: object) -> List[int]:
        ids: List[int] = []

        def walk(node: object) -> None:
            if isinstance(node, dict):
                for key, value in node.items():
                    lowered = key.lower()
                    if isinstance(value, (int, str)) and "checklist" in lowered:
                        try:
                            ids.append(int(value))
                        except (TypeError, ValueError):
                            continue
                    elif isinstance(value, (dict, list)):
                        walk(value)
            elif isinstance(node, list):
                for item in node:
                    walk(item)

        walk(contents)
        return ids

    def _load_daily_evaluations(
        self,
        checklist_titles: Dict[int, str],
    ) -> Dict[int, List[Dict[str, object]]]:
        start_dt = dt.datetime.combine(self.target_date, dt.time.min)
        end_dt = start_dt + dt.timedelta(days=1)
        sql = """
            SELECT
                weh.id,
                weh.worker_id,
                weh.work_id,
                weh.checklist_title_array,
                weh.checklist_point_sum,
                weh.evaluate_dttm,
                cr.room_no,
                b.building_short_name,
                wr.contents1,
                wr.contents2
            FROM worker_evaluateHistory AS weh
            LEFT JOIN work_header AS wh ON wh.id = weh.work_id
            LEFT JOIN client_rooms AS cr ON wh.room_id = cr.id
            LEFT JOIN etc_buildings AS b ON cr.building_id = b.id
            LEFT JOIN work_reports AS wr ON wr.work_id = weh.work_id AND wr.type = 1
            WHERE weh.evaluate_dttm >= %s AND weh.evaluate_dttm < %s
        """
        evaluations: Dict[int, List[Dict[str, object]]] = {}
        with self.conn.cursor(dictionary=True) as cur:
            cur.execute(sql, (start_dt, end_dt))
            for row in cur:
                worker_id = int(row["worker_id"])
                checklist_raw = row.get("checklist_title_array")
                try:
                    checklist_ids: Iterable[int] = json.loads(checklist_raw) if checklist_raw else []
                except Exception:
                    checklist_ids = []
                report_ids: List[int] = []
                for key in ("contents1", "contents2"):
                    contents = row.get(key)
                    if contents is None:
                        continue
                    parsed_contents = contents
                    if isinstance(contents, str):
                        try:
                            parsed_contents = json.loads(contents)
                        except Exception:
                            parsed_contents = contents
                    report_ids.extend(self._extract_checklist_ids_from_reports(parsed_contents))
                all_ids = list({*list(checklist_ids), *report_ids})
                deductions = [checklist_titles.get(i, f"{i}") for i in all_ids if i is not None]
                room_label = "".join(
                    filter(None, [row.get("building_short_name") or "", row.get("room_no") or ""])
                )
                entry = dict(
                    id=int(row["id"]),
                    work_id=int(row["work_id"]),
                    points=int(row.get("checklist_point_sum") or 0),
                    evaluate_dttm=row.get("evaluate_dttm"),
                    room_name=room_label,
                    deductions=deductions,
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

    def _generate_comments(
        self, evaluations: Dict[int, List[Dict[str, object]]], daily_trend: Dict[int, List[Dict[str, object]]]
    ) -> Dict[int, str]:
        if not self.openai_api_key:
            logging.warning("OPENAI_API_KEY가 없어 코멘트 생성을 건너뜁니다.")
            return {}
        payload = {
            "target_date": str(self.target_date),
            "workers": [],
        }
        for worker_id, entries in evaluations.items():
            sorted_entries = sorted(
                entries,
                key=lambda e: (
                    e.get("evaluate_dttm") or dt.datetime.min,
                    e.get("id", 0),
                ),
            )
            payload["workers"].append(
                {
                    "worker_id": worker_id,
                    "today": [
                        {
                            "evaluation_id": e["id"],
                            "work_id": e.get("work_id"),
                            "room": e.get("room_name"),
                            "score": e.get("points"),
                            "deductions": e.get("deductions", []),
                            "evaluated_at": e.get("evaluate_dttm").isoformat()
                            if isinstance(e.get("evaluate_dttm"), dt.datetime)
                            else None,
                        }
                        for e in sorted_entries
                    ],
                    "scores_thesedays": daily_trend.get(worker_id, []),
                }
            )

        if not payload["workers"]:
            return {}

        instruction = (
            "아래 JSON으로 제공된 오늘 작업 정보와 최근 일주일 점수를 분석하여 클리너별 코멘트를 생성하세요. "
            "모든 데이터를 한 번에 전달하므로, 응답도 worker_id를 키로 가진 JSON 한 건으로만 반환하세요. "
            "각 worker 코멘트는 200~255자 이내의 한국어 2~3문장으로 작성하고, 줄바꿈과 이모지, 특수문자를 사용하지 마세요. "
            "첫 문장은 긍정적이면서 전체 수행을 요약하고, 두 번째 문장은 감점이 집중된 체크리스트 항목이나 패턴을 짧게 언급하세요. "
            "세 번째 문장은 실행 가능한 개선 제안을 존댓말로 제공하세요. 오늘 점수 흐름이나 작업 순서에서 집중력 저하가 보일 때만 간단히 언급하세요. "
            "최근 일주일 점수는 상승/하락/유지 중 하나로만 짧게 설명하세요. "
            "같은 날짜 다른 사람들의 점수와 비교한 격려 멘트도 한 문장에 자연스럽게 섞어주세요. "
            "사람의 성격·태도에 대한 추측은 금지하며, 제공된 객실명, 감점 항목 title, 점수, 날짜별 추세 외 정보는 사용하지 마세요. "
            "필요한 경우 감점이 집중된 항목을 예시처럼 자연스럽게 녹여 주세요(욕실 청소, 침구 정리 등). "
            "응답 형식: {\"<worker_id>\": \"코멘트\", ...} JSON만 반환하세요."
        )

        request_body = {
            "model": "gpt-4o-mini",
            "messages": [
                {
                    "role": "system",
                    "content": "숙소 청소 결과를 요약·분석하고 개선 제안을 주는 평가자입니다. JSON만 반환하세요.",
                },
                {
                    "role": "user",
                    "content": f"{instruction}\ninput_json={json.dumps(payload, ensure_ascii=False)}",
                },
            ],
            "max_tokens": 4000,
            "temperature": 0.6,
        }

        logging.info("AI 요청 입력: %s", json.dumps(payload, ensure_ascii=False))
        comments: Dict[int, str] = {}
        try:
            resp = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json=request_body,
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
            message = data["choices"][0]["message"]["content"].strip()
            logging.info("AI 응답 원문: %s", message)
            try:
                parsed = json.loads(message)
            except json.JSONDecodeError:
                logging.warning("AI 응답을 JSON으로 파싱할 수 없습니다: %s", message)
                return {}
            for worker_id, comment in parsed.items():
                try:
                    wid_int = int(worker_id)
                except (TypeError, ValueError):
                    continue
                if not isinstance(comment, str):
                    continue
                comments[wid_int] = comment.strip()[:255]
            logging.info("AI 코멘트 생성 완료: %s명", len(comments))
        except Exception as exc:  # pylint: disable=broad-except
            logging.warning("AI 코멘트 생성 실패: %s", exc)
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
