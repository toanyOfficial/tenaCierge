#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""클리너 랭킹/점수 업데이트 배치."""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import logging
import math
import os
import traceback
import time
from decimal import Decimal
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

import mysql.connector
from mysql.connector import errors as mysql_errors
import requests

KST = dt.timezone(dt.timedelta(hours=9))
MAX_OPENAI_CALLS_PER_RUN = 3
COMMENT_DB_LIMIT = 240
SCHEMA_CSV_PATH = Path(__file__).resolve().parent.parent / "docsForCodex" / "schema.csv"


def configure_logging() -> None:
    base_dir = Path(__file__).resolve().parent
    log_path = base_dir / "update_cleaner_ranking.log"
    handlers = [logging.StreamHandler()]
    try:
        handlers.append(logging.FileHandler(log_path, encoding="utf-8"))
    except Exception:
        pass
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=handlers,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="클리너 랭킹 업데이트 배치")
    parser.add_argument(
        "--target-date",
        type=lambda s: dt.datetime.strptime(s, "%Y-%m-%d").date(),
        default=dt.datetime.now(KST).date(),
        help="업데이트 기준 일자 (기본: 오늘)",
    )
    parser.add_argument(
        "--disable-ai-comment",
        action="store_true",
        help="AI 코멘트 생성을 비활성화합니다.",
    )
    return parser.parse_args()


def get_db_connection(*, autocommit: bool = False) -> mysql.connector.MySQLConnection:
    cfg = dict(
        host=os.environ.get("DB_HOST", "127.0.0.1"),
        port=int(os.environ.get("DB_PORT", 3306)),
        user=os.environ.get("DB_USER", "root"),
        password=os.environ.get("DB_PASSWORD", ""),
        database=os.environ.get("DB_NAME", "tenaCierge"),
        autocommit=autocommit,
    )
    logging.info("DB 접속 정보: %s:%s/%s", cfg["host"], cfg["port"], cfg["database"])
    return mysql.connector.connect(**cfg)


def log_batch_execution(
    conn: Optional[mysql.connector.MySQLConnection],
    *,
    app_name: str,
    start_dttm: dt.datetime,
    end_dttm: dt.datetime,
    end_flag: int,
    context: Optional[Dict[str, object]] = None,
) -> None:
    """배치 실행 이력을 DB에 적재한다."""

    log_conn = conn if conn is not None and conn.is_connected() else get_db_connection(autocommit=True)
    should_close = log_conn is not conn
    try:
        with log_conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS etc_errorLogs_batch (
                    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    app_name VARCHAR(64) NOT NULL,
                    start_dttm DATETIME NOT NULL,
                    end_dttm DATETIME NOT NULL,
                    end_flag TINYINT NOT NULL,
                    context_json JSON NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
                """,
            )
            cur.execute(
                """
                INSERT INTO etc_errorLogs_batch
                    (app_name, start_dttm, end_dttm, end_flag, context_json)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    app_name,
                    start_dttm,
                    end_dttm,
                    end_flag,
                    json.dumps(context or {}, ensure_ascii=False),
                ),
            )
        log_conn.commit()
    except Exception:
        logging.error("배치 실행 로그 저장 실패", exc_info=True)
    finally:
        if should_close:
            log_conn.close()


def _safe_json_loads(value: object) -> object:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return value
    return value


def _extract_ids_from_json(value: object) -> List[int]:
    ids: List[int] = []
    parsed = _safe_json_loads(value)

    def walk(node: object) -> None:
        if isinstance(node, list):
            for item in node:
                walk(item)
        elif isinstance(node, dict):
            for item in node.values():
                walk(item)
        elif isinstance(node, (int, float)) and not isinstance(node, bool):
            if isinstance(node, float) and math.isnan(node):
                return
            try:
                ids.append(int(node))
            except (TypeError, ValueError, OverflowError):
                return
        elif isinstance(node, str):
            try:
                parsed_int = int(node)
            except (TypeError, ValueError):
                return
            ids.append(parsed_int)

    walk(parsed)
    return ids


def _extract_supply_note(contents: object, checklist_id: int) -> Optional[str]:
    parsed = _safe_json_loads(contents)

    if isinstance(parsed, dict):
        for key in (checklist_id, str(checklist_id)):
            if key in parsed:
                note = parsed.get(key)
                if note is None:
                    return None
                if isinstance(note, (str, int, float)):
                    text = str(note).strip()
                    return text or None
    elif isinstance(parsed, str):
        stripped = parsed.strip()
        return stripped or None

    return None


def _fetch_supply_reports(
    conn: mysql.connector.MySQLConnection, run_date: dt.date
) -> List[Dict[str, object]]:
    sql = """
        SELECT wr.work_id, wr.contents1, wr.contents2,
               wh.room_id, cr.client_id, cr.building_id
        FROM work_reports AS wr
        INNER JOIN work_header AS wh ON wh.id = wr.work_id
        INNER JOIN client_rooms AS cr ON cr.id = wh.room_id
        WHERE wh.date = %s AND wr.type = 2
    """
    with conn.cursor(dictionary=True) as cur:
        cur.execute(sql, (run_date,))
        return list(cur)


def _fetch_next_work_dates(
    conn: mysql.connector.MySQLConnection, run_date: dt.date
) -> Dict[int, dt.date]:
    sql = """
        SELECT room_id, MIN(date) AS next_date
        FROM work_header
        WHERE date > %s
        GROUP BY room_id
    """

    next_dates: Dict[int, dt.date] = {}
    with conn.cursor(dictionary=True) as cur:
        cur.execute(sql, (run_date,))
        for row in cur:
            if row.get("next_date"):
                next_dates[int(row["room_id"])] = row["next_date"]
    return next_dates


def _fetch_checklist_lookup(
    conn: mysql.connector.MySQLConnection, ids: Sequence[int]
) -> Dict[int, Dict[str, Optional[str]]]:
    if not ids:
        return {}

    sql = """
        SELECT id, title, dscpt
        FROM work_checklist_list
        WHERE id IN (%s)
    """ % (", ".join(["%s"] * len(ids)))

    lookup: Dict[int, Dict[str, Optional[str]]] = {}
    with conn.cursor(dictionary=True) as cur:
        cur.execute(sql, tuple(ids))
        for row in cur:
            lookup[int(row["id"])] = {
                "title": row.get("title") or "",
                "dscpt": row.get("dscpt"),
            }
    return lookup


def _persist_client_supplements(conn: mysql.connector.MySQLConnection, run_date: dt.date) -> None:
    reports = _fetch_supply_reports(conn, run_date)
    if not reports:
        logging.info("공급품 보고 없음 - 적재 스킵(run_date=%s)", run_date)
        return

    next_dates = _fetch_next_work_dates(conn, run_date)

    checklist_ids: List[int] = []
    for row in reports:
        checklist_ids.extend(_extract_ids_from_json(row.get("contents1")))

    checklist_lookup = _fetch_checklist_lookup(conn, sorted({cid for cid in checklist_ids}))
    if not checklist_lookup:
        logging.info("공급품 체크리스트 매핑 없음 - 적재 스킵(run_date=%s)", run_date)
        return

    inserts: List[Tuple[int, dt.date, Optional[dt.date], str, Optional[str]]] = []

    for row in reports:
        room_id = int(row.get("room_id"))
        ids = _extract_ids_from_json(row.get("contents1"))
        if not ids:
            continue
        notes = row.get("contents2")
        next_date = next_dates.get(room_id)

        for cid in ids:
            checklist = checklist_lookup.get(cid)
            if not checklist:
                logging.warning("체크리스트 ID %s를 찾을 수 없어 건너뜀 (room_id=%s)", cid, room_id)
                continue

            title = checklist.get("title") or f"항목 {cid}"
            description = checklist.get("dscpt")
            if description is None or str(description).strip() == "":
                description = _extract_supply_note(notes, cid)
            if description is None:
                description = ""

            inserts.append((room_id, run_date, next_date, title, description))

    if not inserts:
        logging.info("적재할 공급품 데이터가 없음(run_date=%s)", run_date)
        return

    logging.info("client_supplements 적재 준비: row %s건", len(inserts))

    with conn.cursor() as cur:
        cur.execute("DELETE FROM client_supplements WHERE date = %s", (run_date,))
        cur.executemany(
            """
            INSERT INTO client_supplements (room_id, date, next_date, title, dscpt)
            VALUES (%s, %s, %s, %s, %s)
            """,
            inserts,
        )
    conn.commit()
    logging.info("client_supplements 적재 완료: %s건", len(inserts))


class CleanerRankingBatch:
    def __init__(self, conn, target_date: dt.date, *, disable_ai_comment: bool = False) -> None:
        self.conn = conn
        self.target_date = target_date
        self.openai_api_key = os.environ.get("OPENAI_API_KEY")
        self.disable_ai_comment = disable_ai_comment
        self.openai_calls = 0
        self.admin_worker_ids: set[int] = set()
        self.schema_columns = self._load_schema_columns()

    def run(self) -> None:
        self.admin_worker_ids = self._load_admin_workers()
        self._apply_additional_room_prices()
        self._award_butler_bonus()
        checklist_titles, checklist_scores = self._load_checklist_metadata()
        today_scores = self._update_daily_checklist_points(checklist_scores)
        daily_trend = self._load_daily_trend_scores()
        daily_evals = self._load_daily_evaluations(checklist_titles)
        comments = self._generate_comments(daily_evals, daily_trend)
        if comments:
            self._persist_comments(comments, daily_evals)
        workers = self._load_workers()
        if not workers:
            logging.info("worker_header 인원이 없어 종료합니다.")
            return
        self._persist_score_20days(today_scores, workers)
        tier_rules = self._load_tier_rules()
        tier_population = self._load_tiering_population()
        tier_updates = self._calculate_tiers(tier_population, tier_rules) if tier_rules else {}
        self._persist_tiers(tier_updates)
        self._persist_daily_hourly_wage()
        self.conn.commit()

    def _award_butler_bonus(self) -> None:
        """Position=2 버틀러 근무자에게 당일 가산점을 부여한다."""

        start_dt = dt.datetime.combine(self.target_date, dt.time.min)
        end_dt = start_dt + dt.timedelta(days=1)
        with self.conn.cursor(dictionary=True) as cur:
            cur.execute(
                """
                SELECT DISTINCT worker_id
                FROM work_apply
                WHERE work_date = %s
                  AND position = 2
                  AND worker_id IS NOT NULL
                """,
                (self.target_date,),
            )
            workers = [int(row["worker_id"]) for row in cur]

        workers = [wid for wid in workers if wid not in self.admin_worker_ids]

        if not workers:
            return

        bonus_label = "버틀러 근무 가산점"
        checklist_json = json.dumps([bonus_label], ensure_ascii=False)
        now_kst = dt.datetime.now(KST).replace(tzinfo=None)

        with self.conn.cursor(dictionary=True) as cur:
            cur.execute(
                """
                SELECT DISTINCT worker_id
                FROM worker_evaluateHistory
                WHERE evaluate_dttm >= %s
                  AND evaluate_dttm < %s
                  AND comment = %s
                """,
                (start_dt, end_dt, bonus_label),
            )
            existing = {int(row["worker_id"]) for row in cur}

        targets = [w for w in workers if w not in existing]
        if not targets:
            return

        with self.conn.cursor() as cur:
            for worker_id in targets:
                cur.execute(
                    """
                    INSERT INTO worker_evaluateHistory
                        (worker_id, evaluate_dttm, work_id, checklist_title_array, checklist_point_sum, comment)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        worker_id,
                        now_kst,
                        0,
                        checklist_json,
                        75,
                        bonus_label,
                    ),
                )
        logging.info("버틀러 근무 가산점 부여: %s명", len(targets))

    def _apply_additional_room_prices(self) -> None:
        work_columns = self._get_table_columns("work_header")
        checkin_col = "checkin_time" if "checkin_time" in work_columns else None
        checkout_col: Optional[str]
        if "checkout_time" in work_columns:
            checkout_col = "checkout_time"
        elif "ceckout_time" in work_columns:
            checkout_col = "ceckout_time"
        else:
            checkout_col = None

        if not checkin_col or not checkout_col:
            self._log_error(
                message="work_header 체크인/체크아웃 컬럼을 찾을 수 없어 추가 금액 산정을 건너뜁니다.",
                context={"table": "work_header", "columns": sorted(work_columns)},
            )
            return

        price_list_columns = self._get_table_columns("client_price_list")
        price_amount_col = self._resolve_amount_column(
            price_list_columns, ["amount", "amount_per_cleaning", "amount_per_room", "price", "value"]
        )
        if not price_amount_col:
            self._log_error(
                message="client_price_list 금액 컬럼을 찾을 수 없어 추가 금액 산정을 건너뜁니다.",
                context={"table": "client_price_list", "columns": sorted(price_list_columns)},
            )
            return

        additional_columns = self._get_table_columns("client_additional_price")
        additional_amount_col = self._resolve_amount_column(additional_columns, ["price", "amount", "value"])
        if not additional_amount_col:
            self._log_error(
                message="client_additional_price 금액 컬럼을 찾을 수 없어 추가 금액 산정을 건너뜁니다.",
                context={"table": "client_additional_price", "columns": sorted(additional_columns)},
            )
            return

        has_qty_column = "qty" in additional_columns

        with self.conn.cursor(dictionary=True) as cur:
            cur.execute(
                f"""
                SELECT
                    id,
                    room_id,
                    amenities_qty,
                    blanket_qty,
                    {checkin_col} AS checkin_time,
                    {checkout_col} AS checkout_time
                FROM work_header
                WHERE date = %s
                  AND cancel_yn = 0
                """,
                (self.target_date,),
            )
            works = list(cur)

        if not works:
            return

        room_ids = [int(w["room_id"]) for w in works if w.get("room_id") is not None]
        if not room_ids:
            return

        rooms: Dict[int, Dict[str, object]] = {}
        placeholders = ", ".join(["%s"] * len(room_ids))
        with self.conn.cursor(dictionary=True) as cur:
            cur.execute(
                f"""
                SELECT id, price_set_id, bed_count, checkin_time, checkout_time
                FROM client_rooms
                WHERE id IN ({placeholders})
                """,
                tuple(room_ids),
            )
            for row in cur:
                rooms[int(row["id"])] = row

        if not rooms:
            return

        price_fields = ["id", "title", f"{price_amount_col} AS amount"]
        if "type" in price_list_columns:
            price_fields.append("type")
        if "minus_yn" in price_list_columns:
            price_fields.append("minus_yn")
        if "ratio_yn" in price_list_columns:
            price_fields.append("ratio_yn")

        price_map: Dict[int, Dict[str, object]] = {}
        with self.conn.cursor(dictionary=True) as cur:
            cur.execute(
                f"""
                SELECT {', '.join(price_fields)}
                FROM client_price_list
                WHERE id IN (9, 10, 15, 16)
                """
            )
            for row in cur:
                price_map[int(row["id"])] = row

        price_set_columns = self._get_table_columns("client_price_set_detail")
        set_amount_col = self._resolve_amount_column(
            price_set_columns,
            [price_amount_col, "amount", "price", "value", "amount_per_cleaning", "amount_per_room"],
        )
        price_set_ids = {int(r.get("price_set_id")) for r in rooms.values() if r.get("price_set_id")}
        set_price_map: Dict[tuple[int, int], Dict[str, object]] = {}
        if set_amount_col and price_set_ids:
            set_fields = ["price_set_id", "price_id", f"{set_amount_col} AS amount"]
            for col in ("title", "type", "minus_yn", "ratio_yn"):
                if col in price_set_columns:
                    set_fields.append(col)

            placeholders_set = ", ".join(["%s"] * len(price_set_ids))
            with self.conn.cursor(dictionary=True) as cur:
                cur.execute(
                    f"""
                    SELECT {', '.join(set_fields)}
                    FROM client_price_set_detail
                    WHERE price_id IN (9, 10, 15, 16)
                      AND price_set_id IN ({placeholders_set})
                    """,
                    tuple(price_set_ids),
                )
                for row in cur:
                    set_price_map[(int(row["price_set_id"]), int(row["price_id"]))] = row

        if not price_map:
            self._log_error(
                message="client_price_list에서 필요한 추가 요금 항목을 찾을 수 없습니다.",
                context={"expected_ids": [9, 10, 15, 16]},
            )
            return

        existing_titles: Set[tuple[int, str]] = set()
        per_room_max_seq: Dict[int, int] = {}
        with self.conn.cursor(dictionary=True) as cur:
            cur.execute(
                f"""
                SELECT room_id, title, seq
                FROM client_additional_price
                WHERE date = %s
                  AND room_id IN ({placeholders})
                """,
                (self.target_date, *room_ids),
            )
            for row in cur:
                room_id = int(row["room_id"])
                existing_titles.add((room_id, row.get("title") or ""))
                per_room_max_seq[room_id] = max(per_room_max_seq.get(room_id, 0), int(row.get("seq") or 0))

        inserts: List[Dict[str, object]] = []

        for work in works:
            room_id = int(work["room_id"])
            room = rooms.get(room_id)
            if not room:
                continue

            bed_count = int(room.get("bed_count") or 0)
            amenities_qty = int(work.get("amenities_qty") or 0)
            blanket_qty = int(work.get("blanket_qty") or 0)

            def resolve_price_row(price_id: int) -> Optional[Dict[str, object]]:
                price_set_id = room.get("price_set_id")
                override_row = None
                if price_set_id is not None:
                    override_row = set_price_map.get((int(price_set_id), price_id))

                base_row = price_map.get(price_id)
                if override_row is None:
                    return base_row

                merged = dict(base_row) if base_row else {}
                for key, value in override_row.items():
                    if key in {"price_set_id", "price_id"}:
                        continue
                    if value is not None:
                        merged[key] = value
                return merged

            def add_charge(price_id: int, quantity: int, reason: str) -> None:
                if quantity <= 0:
                    return
                price_row = resolve_price_row(price_id)
                if not price_row or price_row.get("amount") is None:
                    return
                title = price_row.get("title") or ""
                if (room_id, title) in existing_titles:
                    return
                unit_amount = Decimal(str(price_row.get("amount")))
                amount_value = unit_amount if has_qty_column else unit_amount * Decimal(quantity)
                per_room_max_seq[room_id] = per_room_max_seq.get(room_id, 0) + 1
                entry = {
                    "room_id": room_id,
                    "date": self.target_date,
                    "seq": per_room_max_seq[room_id],
                    "title": title,
                    additional_amount_col: amount_value,
                }
                if has_qty_column:
                    entry["qty"] = quantity
                if "minus_yn" in additional_columns:
                    entry["minus_yn"] = price_row.get("minus_yn", 0)
                if "ratio_yn" in additional_columns:
                    entry["ratio_yn"] = price_row.get("ratio_yn", 0)
                if "comment" in additional_columns:
                    entry["comment"] = reason
                inserts.append(entry)
                existing_titles.add((room_id, title))

            add_charge(15, amenities_qty - bed_count, "비품 수량 초과")
            add_charge(16, blanket_qty - bed_count, "이불 수량 초과")

            room_checkout = self._to_time(room.get("checkout_time"))
            work_checkout = self._to_time(work.get("checkout_time"))
            if room_checkout and work_checkout:
                diff_minutes = self._diff_minutes(work_checkout, room_checkout)
                add_charge(10, math.ceil(diff_minutes / 60) if diff_minutes > 0 else 0, "늦은 체크아웃")

            room_checkin = self._to_time(room.get("checkin_time"))
            work_checkin = self._to_time(work.get("checkin_time"))
            if room_checkin and work_checkin:
                diff_minutes = self._diff_minutes(room_checkin, work_checkin)
                add_charge(9, math.ceil(diff_minutes / 60) if diff_minutes > 0 else 0, "이른 체크인")

        if not inserts:
            return

        insert_columns = ["room_id", "date", "seq", "title", additional_amount_col]
        if has_qty_column:
            insert_columns.append("qty")
        if "minus_yn" in additional_columns:
            insert_columns.append("minus_yn")
        if "ratio_yn" in additional_columns:
            insert_columns.append("ratio_yn")
        if "comment" in additional_columns:
            insert_columns.append("comment")

        placeholders_insert = ", ".join(["%s"] * len(insert_columns))
        columns_sql = ", ".join(insert_columns)
        values = [[entry.get(col) for col in insert_columns] for entry in inserts]
        with self.conn.cursor() as cur:
            cur.executemany(
                f"INSERT INTO client_additional_price ({columns_sql}) VALUES ({placeholders_insert})",
                values,
            )
        logging.info("client_additional_price 자동 추가 %s건", len(inserts))

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
                worker_id = int(row["worker_id"])
                if worker_id in self.admin_worker_ids:
                    continue
                scores[worker_id] = float(row["total"] or 0)
        logging.info(
            "%s ~ %s 점수 수집: %s명",
            start_dt.date(),
            (end_dt - dt.timedelta(days=1)).date(),
            len(scores),
        )
        return scores

    def _load_admin_workers(self) -> set[int]:
        sql = "SELECT id FROM worker_header WHERE tier = 99"
        admin_ids: set[int] = set()
        with self.conn.cursor(dictionary=True) as cur:
            cur.execute(sql)
            for row in cur:
                admin_ids.add(int(row["id"]))
        if admin_ids:
            logging.info("관리자(tier=99) 제외 대상: %s명", len(admin_ids))
        return admin_ids

    def _load_workers(self) -> List[Dict[str, Optional[float]]]:
        with self.conn.cursor(dictionary=True) as cur:
            cur.execute("SELECT id, tier, score_20days FROM worker_header")
            workers: List[Dict[str, Optional[float]]] = []
            for row in cur:
                wid = row["id"]
                if wid in self.admin_worker_ids:
                    continue
                row["score_20days"] = float(row.get("score_20days") or 0.0)
                workers.append(row)
        return workers

    def _load_checklist_metadata(self) -> Tuple[Dict[int, str], Dict[int, int]]:
        sql = "SELECT id, title, score FROM work_checklist_list"
        titles: Dict[int, str] = {}
        scores: Dict[int, int] = {}
        with self.conn.cursor(dictionary=True) as cur:
            cur.execute(sql)
            for row in cur:
                cid = int(row["id"])
                titles[cid] = row.get("title") or ""
                try:
                    scores[cid] = int(row.get("score") or 0)
                except (TypeError, ValueError):
                    scores[cid] = 0
        return titles, scores

    def _update_daily_checklist_points(self, checklist_scores: Dict[int, int]) -> Dict[int, int]:
        start_dt = dt.datetime.combine(self.target_date, dt.time.min)
        end_dt = start_dt + dt.timedelta(days=1)
        sql = """
            SELECT id, worker_id, checklist_title_array
            FROM worker_evaluateHistory
            WHERE evaluate_dttm >= %s
              AND evaluate_dttm < %s
        """
        updates: List[Tuple[int, int]] = []
        today_scores: Dict[int, int] = {}
        with self.conn.cursor(dictionary=True) as cur:
            cur.execute(sql, (start_dt, end_dt))
            for row in cur:
                worker_id = int(row.get("worker_id"))
                if worker_id in self.admin_worker_ids:
                    continue
                checklist_ids = _extract_ids_from_json(row.get("checklist_title_array"))
                point_sum = sum(checklist_scores.get(cid, 0) for cid in checklist_ids)
                today_scores[worker_id] = today_scores.get(worker_id, 0) + point_sum
                updates.append((point_sum, int(row.get("id"))))

        if updates:
            with self.conn.cursor() as cur:
                cur.executemany(
                    "UPDATE worker_evaluateHistory SET checklist_point_sum=%s WHERE id=%s",
                    updates,
                )
        logging.info("checklist_point_sum 갱신 %s건", len(updates))
        return today_scores

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
                if worker_id in self.admin_worker_ids:
                    continue
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
                if worker_id in self.admin_worker_ids:
                    continue
                checklist_raw = row.get("checklist_title_array")
                parsed_checklists = None
                try:
                    parsed_checklists = json.loads(checklist_raw) if checklist_raw else []
                except Exception:
                    parsed_checklists = []
                checklist_ids: Iterable[int]
                if isinstance(parsed_checklists, list):
                    checklist_ids = parsed_checklists
                else:
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
                    comment_candidate=isinstance(parsed_checklists, list),
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

    def _load_tiering_population(self) -> List[Dict[str, float]]:
        """티어 재산정 대상(현재 tier 3~7)과 score_20days를 최신 상태로 조회."""

        sql = """
            SELECT id, tier, COALESCE(score_20days, 0) AS score
            FROM worker_header
            WHERE tier BETWEEN 3 AND 7
        """

        population: List[Dict[str, float]] = []
        with self.conn.cursor(dictionary=True) as cur:
            cur.execute(sql)
            for row in cur:
                population.append(
                    {
                        "id": int(row["id"]),
                        "tier": int(row["tier"]) if row.get("tier") is not None else None,
                        "score": float(row.get("score") or 0.0),
                    }
                )

        return population

    def _calculate_tiers(
        self,
        population: Sequence[Dict[str, Optional[float]]],
        tier_rules: Sequence[Dict[str, int]],
    ) -> Dict[int, int]:
        assigned: Dict[int, int] = {}
        eligible = [w for w in population if w.get("tier") is not None]
        eligible.sort(key=lambda w: w.get("score", 0.0), reverse=True)
        n = len(eligible)
        if not n:
            return assigned
        ordered_rules = sorted(tier_rules, key=lambda r: r["max_percentage"], reverse=True)
        for idx, worker in enumerate(eligible):
            # 상위 백분위(최상위=100, 최하위>0) 기준으로 구간 매칭
            percentile_top = ((n - idx) / n) * 100
            rule = next(
                (
                    r
                    for r in ordered_rules
                    if percentile_top >= r["min_percentage"] and percentile_top <= r["max_percentage"]
                ),
                None,
            )
            if rule:
                assigned[int(worker["id"])] = rule["tier"]
        return assigned

    def _generate_comments(
        self, evaluations: Dict[int, List[Dict[str, object]]], daily_trend: Dict[int, List[Dict[str, object]]]
    ) -> Dict[int, str]:
        if self.disable_ai_comment:
            logging.info("--disable-ai-comment 옵션으로 코멘트 생성을 건너뜁니다.")
            return {}
        if not self.openai_api_key:
            logging.warning("OPENAI_API_KEY가 없어 코멘트 생성을 건너뜁니다.")
            return {}
        payload = {
            "target_date": str(self.target_date),
            "workers": [],
        }
        for worker_id, entries in evaluations.items():
            candidate_entries = [e for e in entries if e.get("comment_candidate")]
            if not candidate_entries:
                continue
            sorted_entries = sorted(
                candidate_entries,
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

        return self._request_ai_comments(payload)

    def _request_ai_comments(self, payload: Dict[str, object]) -> Dict[int, str]:
        comments: Dict[int, str] = {}
        last_error: Optional[Exception] = None
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
                    "content": (
                        "숙소 청소 결과를 요약·분석하고 개선 제안을 주는 평가자입니다. JSON만 반환하세요. "
                        "각 코멘트는 255자를 넘기지 말고 가능하면 200자 안팎으로 2~3문장으로 작성하세요."
                    ),
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
        backoff_delays = [1, 2, 4]
        max_retries = len(backoff_delays)
        for attempt in range(max_retries + 1):
            if self.openai_calls >= MAX_OPENAI_CALLS_PER_RUN:
                logging.warning(
                    "OpenAI 호출 상한(%s회)을 초과하여 코멘트 생성을 건너뜁니다.",
                    MAX_OPENAI_CALLS_PER_RUN,
                )
                break
            self.openai_calls += 1
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
                if resp.status_code in {400, 401, 403, 404, 422}:
                    logging.warning(
                        "AI 코멘트 생성 실패: status=%s, body=%s", resp.status_code, resp.text[:500]
                    )
                    break
                if resp.status_code == 429 or resp.status_code >= 500:
                    raise requests.HTTPError(f"{resp.status_code} {resp.reason}")

                resp.raise_for_status()
                raw_text = resp.text
                logging.info("AI 응답 원문: %s", raw_text[:1000])
                data = resp.json()
                message = data["choices"][0]["message"]["content"].strip()
                try:
                    parsed = json.loads(message)
                except json.JSONDecodeError:
                    logging.warning("AI 응답을 JSON으로 파싱할 수 없습니다: %s", message[:500])
                    self._log_error(
                        message="AI 응답 파싱 실패",
                        stacktrace=message,
                        context={"request_body": request_body},
                    )
                    return {}
                expected_ids = {int(w.get("worker_id")) for w in payload.get("workers", []) if w.get("worker_id") is not None}
                for worker_id, comment in parsed.items():
                    try:
                        wid_int = int(worker_id)
                    except (TypeError, ValueError):
                        logging.warning("worker %s 응답 포맷 불일치, 코멘트 스킵", worker_id)
                        continue
                    if not isinstance(comment, str):
                        logging.warning("worker %s 응답 포맷 불일치, 코멘트 스킵", worker_id)
                        continue
                    comments[wid_int] = comment.strip()[:COMMENT_DB_LIMIT]
                for wid in expected_ids - set(comments.keys()):
                    logging.warning("worker %s 응답 포맷 불일치, 코멘트 스킵", wid)
                logging.info("AI 코멘트 생성 완료: %s명", len(comments))
                return comments
            except (requests.Timeout, requests.ConnectionError) as exc:
                if attempt < max_retries:
                    delay = backoff_delays[attempt]
                    logging.warning(
                        "OpenAI 네트워크 오류, %s초 후 재시도 (%s/%s): %s",
                        delay,
                        attempt + 1,
                        max_retries,
                        exc,
                    )
                    time.sleep(delay)
                    continue
                logging.warning("OpenAI 네트워크 오류, 재시도 초과: %s", exc)
                last_error = exc
                break
            except requests.HTTPError as exc:
                status_code = getattr(exc.response, "status_code", None)
                if status_code == 429 and attempt < max_retries:
                    delay = backoff_delays[attempt]
                    logging.warning(
                        "OpenAI 429 발생, %s초 후 재시도 (%s/%s)",
                        delay,
                        attempt + 1,
                        max_retries,
                    )
                    time.sleep(delay)
                    continue
                logging.warning(
                    "AI 코멘트 생성 실패: status=%s, message=%s, body=%s",
                    status_code,
                    exc,
                    getattr(getattr(exc, "response", None), "text", "")[:500],
                )
                last_error = exc
                break
            except Exception as exc:  # pylint: disable=broad-except
                logging.warning("AI 코멘트 생성 실패: %s", exc)
                last_error = exc
                break

        if last_error:
            self._log_error(
                message=f"AI 코멘트 생성 실패: {last_error}",
                stacktrace=traceback.format_exc(),
                context={"request_body": request_body},
            )
        return comments

    def _log_error(
        self,
        *,
        message: str,
        stacktrace: Optional[str] = None,
        error_code: Optional[str] = None,
        level: int = 2,
        context: Optional[Dict[str, object]] = None,
    ) -> None:
        log_conn = (
            self.conn if hasattr(self, "conn") and self.conn and self.conn.is_connected() else get_db_connection(autocommit=True)
        )
        should_close = log_conn is not getattr(self, "conn", None)
        try:
            with log_conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO etc_errorLogs
                        (level, app_name, error_code, message, stacktrace, request_id, user_id, context_json)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        level,
                        "update_cleaner_ranking",
                        error_code,
                        message[:500],
                        stacktrace,
                        None,
                        None,
                        json.dumps(
                            {"target_date": str(self.target_date), **(context or {})},
                            ensure_ascii=False,
                        ),
                    ),
                )
            log_conn.commit()
        except Exception:  # pragma: no cover - 실패 시 로그만 남김
            logging.error("에러로그 저장 실패", exc_info=True)
        finally:
            if should_close:
                log_conn.close()

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
                cur.execute(sql, (comment[:COMMENT_DB_LIMIT], latest_entry["id"]))
        logging.info("AI 코멘트 업데이트 %s명", len(comments))

    def _persist_score_20days(
        self, today_scores: Dict[int, int], workers: Sequence[Dict[str, Optional[float]]]
    ) -> None:
        """오늘 점수를 worker_header.score_20days에 누적한다."""

        eligible = [w for w in workers if w.get("tier") is not None and 2 <= int(w["tier"]) <= 7]
        if not eligible:
            return

        worker_columns = self._get_table_columns("worker_header")
        if "score_20days" not in worker_columns:
            logging.warning("worker_header.score_20days 컬럼이 없어 점수 누적을 건너뜁니다.")
            return

        with self.conn.cursor() as cur:
            for worker in eligible:
                worker_id = int(worker["id"])
                current_score = float(worker.get("score_20days") or 0.0)
                new_score = current_score + float(today_scores.get(worker_id, 0.0))
                cur.execute(
                    "UPDATE worker_header SET score_20days=%s WHERE id=%s",
                    (new_score, worker_id),
                )
        logging.info("score_20days 누적 업데이트 %s건", len(eligible))

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

    def _persist_daily_hourly_wage(self) -> None:
        work_report_columns = self._get_table_columns("work_reports")
        work_header_columns = self._get_table_columns("work_header")
        if "date" not in work_report_columns and "date" not in work_header_columns:
            self._log_error(
                message="work_reports/work_header에 date 컬럼이 없어 시급 적재를 건너뜁니다.",
                context={
                    "work_reports_columns": sorted(work_report_columns),
                    "work_header_columns": sorted(work_header_columns),
                },
            )
            return

        date_filter = "wr.date" if "date" in work_report_columns else "wh.date"
        sql = f"""
            SELECT
                wr.work_id,
                wr.contents1,
                wr.contents2,
                wr.created_at,
                wr.updated_at,
                wh.cleaner_id,
                wh.butler_id,
                wh.date AS work_date
            FROM work_reports AS wr
            JOIN work_header AS wh ON wh.id = wr.work_id
            WHERE wr.type = 6
              AND {date_filter} = %s
        """

        with self.conn.cursor(dictionary=True) as cur:
            cur.execute(sql, (self.target_date,))
            rows = list(cur)

        if not rows:
            return

        worker_ids: Set[int] = set()
        for row in rows:
            for key in ("cleaner_id", "butler_id"):
                value = row.get(key)
                if value is not None:
                    try:
                        worker_ids.add(int(value))
                    except (TypeError, ValueError):
                        continue

        if not worker_ids:
            return

        placeholders = ", ".join(["%s"] * len(worker_ids))
        worker_map: Dict[int, Dict[str, object]] = {}
        with self.conn.cursor(dictionary=True) as cur:
            cur.execute(
                f"""
                    SELECT wh.id, wh.tier, wtr.hourly_wage
                    FROM worker_header AS wh
                    LEFT JOIN worker_tier_rules AS wtr ON wtr.tier = wh.tier
                    WHERE wh.id IN ({placeholders})
                """,
                tuple(worker_ids),
            )
            for row in cur:
                worker_map[int(row["id"])] = row

        if not worker_map:
            return

        salary_columns = self._get_table_columns("worker_salary_history")
        if not {"worker_id", "work_date"}.issubset(salary_columns):
            self._log_error(
                message="worker_salary_history 컬럼을 확인해주세요.",
                context={"columns": sorted(salary_columns)},
            )
            return

        candidate_column_order = [
            "worker_id",
            "work_date",
            "work_id",
            "tier",
            "tier_target_date",
            "start_dttm",
            "start_time",
            "end_dttm",
            "end_time",
            "work_minutes",
            "work_time_minutes",
            "work_hours",
            "work_time_hours",
            "hourly_wage",
            "hourly_wage_target_date",
            "wage_per_hour",
            "daily_wage",
            "total_wage",
            "amount",
        ]

        targets: Dict[int, List[Dict[str, object]]] = {}
        for row in rows:
            worker_id = row.get("cleaner_id") or row.get("butler_id")
            if worker_id is None:
                continue
            try:
                worker_int = int(worker_id)
            except (TypeError, ValueError):
                continue
            worker_info = worker_map.get(worker_int)
            if not worker_info:
                continue
            tier = worker_info.get("tier")
            if tier is None:
                continue
            try:
                tier_int = int(tier)
            except (TypeError, ValueError):
                continue
            if tier_int == 99:
                continue
            targets.setdefault(worker_int, []).append(row)

        for worker_id, worker_rows in targets.items():
            start_dt = self._select_timestamp(worker_rows, "contents1", "start_dttm", earliest=True)
            end_dt = self._select_timestamp(worker_rows, "contents2", "end_dttm", earliest=False)
            if start_dt is None or end_dt is None:
                self._log_error(
                    message="시급 계산을 위한 시작/종료 시간이 없습니다.",
                    context={
                        "worker_id": worker_id,
                        "missing": [
                            key for key, value in {"start_dttm": start_dt, "end_dttm": end_dt}.items() if value is None
                        ],
                    },
                )
                continue

            duration_seconds = (end_dt - start_dt).total_seconds()
            if duration_seconds <= 0:
                self._log_error(
                    message="퇴근 시간이 출근 시간보다 빠릅니다.",
                    context={"worker_id": worker_id, "start_dttm": str(start_dt), "end_dttm": str(end_dt)},
                )
                continue

            tier_value = worker_map[worker_id].get("tier")
            try:
                tier_int = int(tier_value) if tier_value is not None else None
            except (TypeError, ValueError):
                tier_int = None

            hourly_wage_raw = worker_map[worker_id].get("hourly_wage")
            hourly_wage = Decimal(str(hourly_wage_raw)) if hourly_wage_raw is not None else None
            if hourly_wage is None:
                self._log_error(
                    message="해당 tier의 시급 정보를 찾을 수 없습니다.",
                    context={"worker_id": worker_id, "tier": tier_value},
                )
                continue

            work_minutes = Decimal(str(duration_seconds)) / Decimal(60)
            work_hours = work_minutes / Decimal(60)
            total_wage = (hourly_wage * work_hours).quantize(Decimal("0.01"))

            value_map = {
                "worker_id": worker_id,
                "work_date": self.target_date,
                "work_id": None,
                "tier": tier_int,
                "tier_target_date": tier_int,
                "start_dttm": self._to_naive_utc(start_dt),
                "start_time": self._to_naive_utc(start_dt),
                "end_dttm": self._to_naive_utc(end_dt),
                "end_time": self._to_naive_utc(end_dt),
                "work_minutes": float(work_minutes),
                "work_time_minutes": float(work_minutes),
                "work_hours": float(work_hours),
                "work_time_hours": float(work_hours),
                "hourly_wage": float(hourly_wage),
                "hourly_wage_target_date": float(hourly_wage),
                "wage_per_hour": float(hourly_wage),
                "daily_wage": float(total_wage),
                "total_wage": float(total_wage),
                "amount": float(total_wage),
            }

            insert_columns = [
                col for col in candidate_column_order if col in salary_columns and value_map.get(col) is not None
            ]
            if len(insert_columns) < 2:  # worker_id, work_date만 남는 경우는 스킵
                self._log_error(
                    message="worker_salary_history에 적재할 데이터가 부족합니다.",
                    context={"worker_id": worker_id, "available_columns": insert_columns},
                )
                continue

            placeholders = ", ".join(["%s"] * len(insert_columns))
            update_clause = ", ".join([f"{col}=VALUES({col})" for col in insert_columns if col not in {"id"}])
            sql_insert = f"INSERT INTO worker_salary_history ({', '.join(insert_columns)}) VALUES ({placeholders})"
            if update_clause:
                sql_insert += f" ON DUPLICATE KEY UPDATE {update_clause}"

            with self.conn.cursor() as cur:
                cur.execute(sql_insert, tuple(value_map[col] for col in insert_columns))

        logging.info("시급 적재 대상 %s명 완료", len(targets))

    def _resolve_amount_column(self, columns: Set[str], candidates: Sequence[str]) -> Optional[str]:
        lowered = {c.lower() for c in columns}
        for candidate in candidates:
            if candidate.lower() in lowered:
                return candidate.lower()
        return None

    def _load_schema_columns(self) -> Dict[str, Set[str]]:
        mapping: Dict[str, Set[str]] = {}
        target_schema = os.environ.get("DB_NAME", "tenaCierge")
        try:
            with open(SCHEMA_CSV_PATH, newline="", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    if row.get("table_schema") != target_schema:
                        continue
                    table_name = str(row.get("table_name") or "").lower()
                    column_name = str(row.get("column_name") or "").lower()
                    if not table_name or not column_name:
                        continue
                    mapping.setdefault(table_name, set()).add(column_name)
        except FileNotFoundError:
            logging.error("schema.csv 파일을 찾을 수 없어 컬럼 정보를 불러오지 못했습니다: %s", SCHEMA_CSV_PATH)
        except Exception:
            logging.error("schema.csv를 읽는 중 오류가 발생했습니다", exc_info=True)
        return mapping

    def _get_table_columns(self, table: str) -> Set[str]:
        if self.schema_columns:
            return set(self.schema_columns.get(table.lower(), set()))
        logging.warning("schema.csv에서 %s 컬럼 정보를 찾지 못해 빈 집합을 반환합니다", table)
        return set()

    def _to_time(self, value: object) -> Optional[dt.time]:
        if isinstance(value, dt.time):
            return value
        if isinstance(value, dt.timedelta):
            base = dt.datetime.min + value
            return base.time()
        if isinstance(value, str):
            for fmt in ("%H:%M:%S", "%H:%M"):
                try:
                    return dt.datetime.strptime(value, fmt).time()
                except ValueError:
                    continue
        return None

    def _select_timestamp(
        self,
        rows: Sequence[Dict[str, object]],
        contents_key: str,
        timestamp_key: str,
        *,
        earliest: bool,
    ) -> Optional[dt.datetime]:
        candidates: List[tuple[Optional[dt.datetime], dt.datetime]] = []
        for row in rows:
            ts_value = self._extract_timestamp(row.get(contents_key), timestamp_key)
            if ts_value is None:
                continue
            reference = row.get("created_at" if earliest else "updated_at")
            ref_dt = reference if isinstance(reference, dt.datetime) else None
            candidates.append((ref_dt, ts_value))

        if not candidates:
            return None

        key_fn = (lambda pair: pair[0] or (dt.datetime.max if earliest else dt.datetime.min))
        selected = min(candidates, key=key_fn) if earliest else max(candidates, key=key_fn)
        return selected[1]

    def _extract_timestamp(self, payload: object, key: str) -> Optional[dt.datetime]:
        if payload is None:
            return None

        obj = payload
        if isinstance(obj, str):
            try:
                obj = json.loads(obj)
            except Exception:
                obj = None

        if isinstance(obj, dict):
            raw_value = obj.get(key)
            if isinstance(raw_value, str):
                normalized = raw_value.replace("Z", "+00:00")
                try:
                    return dt.datetime.fromisoformat(normalized)
                except ValueError:
                    return None
        return None

    def _to_naive_utc(self, value: dt.datetime) -> dt.datetime:
        if value.tzinfo is None:
            return value
        return value.astimezone(dt.timezone.utc).replace(tzinfo=None)

    def _diff_minutes(self, later: dt.time, earlier: dt.time) -> int:
        later_minutes = later.hour * 60 + later.minute + later.second // 60
        earlier_minutes = earlier.hour * 60 + earlier.minute + earlier.second // 60
        return later_minutes - earlier_minutes


def main() -> None:
    configure_logging()
    args = parse_args()
    start_dttm = dt.datetime.now(dt.timezone.utc)
    conn: Optional[mysql.connector.MySQLConnection] = None
    conn = get_db_connection()
    end_flag = 1
    logging.info("클리너 랭킹 배치 시작")
    batch: Optional[CleanerRankingBatch] = None
    try:
        batch = CleanerRankingBatch(
            conn,
            args.target_date,
            disable_ai_comment=bool(getattr(args, "disable_ai_comment", False)),
        )
        batch.run()
        _persist_client_supplements(conn, args.target_date)
        logging.info("클리너 랭킹 배치 정상 종료")
    except Exception as exc:
        end_flag = 2
        logging.error("클리너 랭킹 배치 비정상 종료", exc_info=exc)
        if batch is not None:
            try:
                batch._log_error(  # pylint: disable=protected-access
                    message=str(exc),
                    stacktrace=traceback.format_exc(),
                )
            except Exception:
                logging.error("에러로그 저장 실패", exc_info=True)
        raise
    finally:
        try:
            log_batch_execution(
                conn,
                app_name="update_cleaner_ranking",
                start_dttm=start_dttm,
                end_dttm=dt.datetime.now(dt.timezone.utc),
                end_flag=end_flag,
                context={"target_date": str(args.target_date)},
            )
        except Exception:
            logging.error("배치 실행 로그 저장 실패", exc_info=True)
        if conn is not None and conn.is_connected():
            conn.close()


if __name__ == "__main__":
    main()
