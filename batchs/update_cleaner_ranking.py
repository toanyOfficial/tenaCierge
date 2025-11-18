#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""클리너 랭킹/점수 업데이트 배치."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import math
import os
from collections import defaultdict
from typing import Dict, Iterable, List, Optional, Sequence

import mysql.connector

KST = dt.timezone(dt.timedelta(hours=9))
SCORE_KEYS = ("current_score", "score", "points", "point", "checklist_point_sum", "total")


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


def _loads_json(value) -> Optional[object]:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8", "ignore")
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError as exc:
            logging.warning("JSON 파싱 실패: %s", exc)
            return None
    return None


def _extract_score(payload) -> Optional[float]:
    if payload is None:
        return None
    if isinstance(payload, (int, float)):
        return float(payload)
    if isinstance(payload, dict):
        for key in SCORE_KEYS:
            if key in payload and isinstance(payload[key], (int, float)):
                return float(payload[key])
        for value in payload.values():
            nested = _extract_score(value)
            if nested is not None:
                return nested
        return None
    if isinstance(payload, list):
        values: List[float] = []
        for item in payload:
            nested = _extract_score(item)
            if nested is not None:
                values.append(nested)
        if values:
            return sum(values) / len(values)
        return None
    return None


class CleanerRankingBatch:
    def __init__(self, conn, target_date: dt.date) -> None:
        self.conn = conn
        self.target_date = target_date

    def run(self) -> None:
        scores = self._fetch_scores()
        if not scores:
            logging.info("%s 기준으로 점수 데이터가 없어 종료합니다.", self.target_date)
            return
        self._update_current_scores(scores)
        workers = self._load_workers()
        tier_updates = self._calculate_tiers(workers, scores.keys())
        self._persist_tiers(tier_updates)
        self.conn.commit()

    def _fetch_scores(self) -> Dict[int, List[float]]:
        sql = """
            SELECT wr.contents1, wr.contents2, wh.cleaner_id
            FROM work_reports wr
            JOIN work_header wh ON wh.id = wr.work_id
            WHERE wr.type = 1
              AND wh.date = %s
              AND wh.cleaner_id IS NOT NULL
        """
        buckets: Dict[int, List[float]] = defaultdict(list)
        with self.conn.cursor(dictionary=True) as cur:
            cur.execute(sql, (self.target_date,))
            for row in cur:
                payload = _loads_json(row["contents1"]) or _loads_json(row["contents2"])
                score = _extract_score(payload)
                if score is None:
                    continue
                buckets[row["cleaner_id"]].append(score)
        logging.info("%s 기준 점수 수집: %s명", self.target_date, len(buckets))
        return buckets

    def _update_current_scores(self, scores: Dict[int, List[float]]) -> None:
        with self.conn.cursor() as cur:
            for worker_id, values in scores.items():
                avg_score = sum(values) / len(values)
                cur.execute(
                    "UPDATE worker_header SET current_score=%s WHERE id=%s",
                    (round(avg_score, 2), worker_id),
                )
        logging.info("current_score 업데이트 %s명", len(scores))

    def _load_workers(self) -> List[Dict[str, Optional[float]]]:
        with self.conn.cursor(dictionary=True) as cur:
            cur.execute("SELECT id, tier, current_score FROM worker_header")
            return list(cur.fetchall())

    def _calculate_tiers(
        self,
        workers: Sequence[Dict[str, Optional[float]]],
        active_worker_ids: Iterable[int],
    ) -> Dict[int, int]:
        active = set(active_worker_ids)
        assigned: Dict[int, int] = {}
        population = [
            w
            for w in workers
            if w["id"] in active and w["tier"] in (4, 5, 6, 7) and w["current_score"] is not None
        ]
        population.sort(key=lambda w: w["current_score"], reverse=True)
        n = len(population)
        if n:
            top5 = min(n, max(1, math.ceil(n * 0.05)))
            top10 = min(n, max(top5, math.ceil(n * 0.10)))
            top30 = min(n, max(top10, math.ceil(n * 0.30)))
            for idx, worker in enumerate(population):
                wid = worker["id"]
                if idx < top5:
                    assigned[wid] = 7
                elif idx < top10:
                    assigned[wid] = 6
                elif idx < top30:
                    assigned[wid] = 5
        for worker in workers:
            wid = worker["id"]
            if wid not in active:
                continue
            if worker["tier"] == 1:
                continue
            if worker["tier"] == 2:
                assigned.setdefault(wid, 3)
                continue
            score = worker["current_score"]
            if score is None:
                continue
            if wid in assigned:
                continue
            assigned[wid] = 4 if score >= 50 else 3
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
