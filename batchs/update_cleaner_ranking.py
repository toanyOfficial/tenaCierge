#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""클리너 랭킹/점수 업데이트 배치."""

from __future__ import annotations

import argparse
import datetime as dt
import logging
import os
from typing import Dict, List, Optional, Sequence

import mysql.connector

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
