#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DB 기반 Forecasting 배치 프로그램.

이 스크립트는 기존 파일 기반(batchs/Forecasting.py) 배치를 참고하여
DB 스키마(client_rooms, work_fore_*, work_header 등)를 직접 사용하도록
재구성한 버전이다. 다음과 같은 단계를 수행한다.

1. database(MySQL) 연결 → 활성 객실 목록 조회(client_rooms + etc_buildings)
2. 객실별 iCal URL 다운로드 및 이벤트 파싱
3. 날짜별(out/potential) 판단 및 p_out 계산
4. work_fore_d1/work_fore_d7/work_fore_accuracy/work_fore_tuning/work_header
   테이블 업데이트

필수 환경변수
----------------
- DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME

주요 CLI 옵션
--------------
--run-date        : 배치 기준일(기본 오늘)
--start-offset    : run-date 기준 시작 offset (기본 1 = D+1)
--end-offset      : run-date 기준 종료 offset (기본 7 = D+7)
--ics-keep-days   : ics 디렉터리 보관 일수(기본 3일, README 규칙 반영)
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import math
import os
import traceback
from dataclasses import dataclass
import re
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import mysql.connector
import requests
from dateutil import tz
from icalendar import Calendar
import shutil

# ------------------------------ 상수 ------------------------------
BASE_DIR = Path(__file__).resolve().parent
ICS_BASE = BASE_DIR / "ics"
SEOUL = tz.gettz("Asia/Seoul")

WEEKDAY_BASE = {0: 0.6, 1: 0.45, 2: 0.45, 3: 0.5, 4: 0.8, 5: 1.0, 6: 0.9}
WEEKDAY_FACTOR = {0: 0.95, 1: 0.90, 2: 0.90, 3: 0.95, 4: 1.00, 5: 1.05, 6: 1.00}

DEFAULT_MODEL = {
    "d1_alpha": 0.12,
    "d1_beta": 0.94,
    "d1_high": 0.43,
    "d7_alpha": 0.147,
    "d7_beta": 1.0181,
    "d7_high": 0.68,
    "borderline": 0.40,
}

D1_PRECISION_TARGET = 0.70
D1_HIGH_STEP = 0.02
D1_HIGH_MIN, D1_HIGH_MAX = 0.40, 0.90

MODEL_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS model_variable (
    `name` VARCHAR(32) NOT NULL PRIMARY KEY,
    `value` DOUBLE NOT NULL,
    `description` VARCHAR(255) NULL,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"""


# ------------------------------ 데이터 구조 ------------------------------
@dataclass
class Room:
    id: int
    building_id: int
    sector: str
    sector_value: str
    building_short_name: str
    building_name: str
    room_no: str
    bed_count: int
    checkin_time: dt.time
    checkout_time: dt.time
    weight: int
    ical_urls: List[str]


@dataclass
class Event:
    start: dt.datetime
    end: dt.datetime


@dataclass
class Prediction:
    room: Room
    target_date: dt.date
    horizon: int
    out_time: Optional[dt.time]
    p_out: float
    label: str  # "○", "△", ""
    has_checkin: bool
    has_checkout: bool
    actual_observed: bool

    @property
    def predicted_positive(self) -> bool:
        return self.label == "○"

    @property
    def correct(self) -> bool:
        if not self.actual_observed:
            return False
        return (self.predicted_positive and self.has_checkout) or (
            (not self.predicted_positive) and (not self.has_checkout)
        )


@dataclass
class ApplyRule:
    min_weight: int
    max_weight: Optional[int]
    cleaner_count: int
    butler_count: int
    level_flag: int


@dataclass
class WorkerAvailability:
    id: int
    tier: int
    add_override: bool
    is_regular: bool


# ------------------------------ 유틸 ------------------------------
def configure_logging() -> None:
    log_path = BASE_DIR / "application.log"
    handlers = [logging.StreamHandler()]
    try:
        file_handler = logging.FileHandler(log_path, encoding="utf-8")
        handlers.append(file_handler)
    except Exception:  # pylint: disable=broad-except
        # 파일 핸들 생성 실패 시 콘솔 로깅만 진행한다.
        pass

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=handlers,
    )


def seoul_today() -> dt.date:
    """현재 서울(KST) 날짜를 반환한다."""

    return dt.datetime.now(dt.timezone.utc).astimezone(SEOUL).date()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="DB 기반 Forecasting 배치")
    parser.add_argument(
        "--run-date",
        type=lambda s: dt.datetime.strptime(s, "%Y-%m-%d").date(),
        default=None,
        help="배치 기준일 (기본: 오늘 KST)",
    )
    parser.add_argument(
        "--start-offset",
        type=int,
        default=1,
        help="기준일 대비 시작 offset (기본 1 = D+1)",
    )
    parser.add_argument(
        "--end-offset",
        type=int,
        default=7,
        help="기준일 대비 종료 offset (기본 7 = D+7)",
    )
    parser.add_argument(
        "--ics-keep-days",
        type=int,
        default=3,
        help="ics 폴더 보관 일수 (README 규칙: 3일)",
    )
    parser.add_argument(
        "--allow-backfill",
        action="store_true",
        help="지정된 run-date를 강제로 사용 (기본은 서울 오늘 날짜로 강제)",
    )
    parser.add_argument(
        "--today-only",
        action="store_true",
        help="당일(D0) work_header만 생성하고 apply/정확도 계산을 건너뜀",
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
    if not cfg["password"]:
        raise SystemExit(
            "DB_PASSWORD가 설정되지 않았습니다. /srv/tenaCierge/.env.batch 등을 로딩하거나 "
            "환경 변수(DB_HOST/DB_USER/DB_PASSWORD/DB_NAME)를 직접 지정해주세요."
        )
    logging.info("DB 접속 정보: %s:%s/%s", cfg["host"], cfg["port"], cfg["database"])
    return mysql.connector.connect(**cfg)


def to_aware(value) -> dt.datetime:
    if isinstance(value, dt.datetime):
        if value.tzinfo:
            return value.astimezone(SEOUL)
        return value.replace(tzinfo=tz.UTC).astimezone(SEOUL)
    if isinstance(value, dt.date):
        return dt.datetime(value.year, value.month, value.day, tzinfo=SEOUL)
    raise TypeError(f"지원하지 않는 타입: {type(value)!r}")


def ensure_ics_dir() -> Path:
    timestamp = dt.datetime.now(SEOUL).strftime("%Y%m%d%H%M%S")
    target_dir = ICS_BASE / timestamp
    target_dir.mkdir(parents=True, exist_ok=True)
    logging.info("ICS 다운로드 폴더: %s", target_dir)
    return target_dir


def rotate_ics_dirs(keep_days: int) -> None:
    if not ICS_BASE.exists():
        return
    cutoff = dt.datetime.now(SEOUL) - dt.timedelta(days=keep_days)
    for path in sorted(ICS_BASE.iterdir()):
        if not path.is_dir():
            continue
        try:
            dt.datetime.strptime(path.name, "%Y%m%d%H%M%S")
        except ValueError:
            continue
        mtime = dt.datetime.fromtimestamp(path.stat().st_mtime, tz=SEOUL)
        if mtime < cutoff:
            logging.info("ICS 폴더 정리: %s", path)
            shutil.rmtree(path, ignore_errors=True)


def sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


# ------------------------------ DB 로더 ------------------------------
def ensure_model_table(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(MODEL_TABLE_SQL)
    conn.commit()


def load_model_variables(conn) -> Dict[str, float]:
    values = DEFAULT_MODEL.copy()

    with conn.cursor(dictionary=True) as cur:
        cur.execute("SELECT name, value FROM work_fore_variable")
        rows = cur.fetchall()
    if rows:
        for row in rows:
            values[row["name"]] = float(row["value"])
        logging.info("모델 변수 로딩 완료: %s", values)
        return values

    ensure_model_table(conn)
    with conn.cursor(dictionary=True) as cur:
        cur.execute("SELECT name, value FROM model_variable")
        for row in cur.fetchall():
            values[row["name"]] = float(row["value"])
    logging.info("모델 변수 로딩 완료: %s", values)
    return values


def save_model_variables(conn, values: Dict[str, float]) -> None:
    with conn.cursor() as cur:
        for name, value in values.items():
            cur.execute(
                """
                INSERT INTO work_fore_variable(name, value)
                VALUES (%s, %s)
                ON DUPLICATE KEY UPDATE value=VALUES(value)
                """,
                (name, value),
            )
    conn.commit()


def log_error(
    conn: mysql.connector.MySQLConnection,
    *,
    message: str,
    stacktrace: Optional[str] = None,
    error_code: Optional[str] = None,
    level: int = 2,
    app_name: str = "db_forecasting",
    run_date: Optional[dt.date] = None,
) -> None:
    """etc_errorLogs 테이블에 오류 정보를 적재한다."""

    try:
        context_json = json.dumps({"run_date": str(run_date or seoul_today())})
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO etc_errorLogs
                    (level, app_name, error_code, message, stacktrace, request_id, user_id, context_json)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    level,
                    app_name,
                    error_code,
                    message[:500],
                    stacktrace,
                    None,
                    None,
                    context_json,
                ),
            )
        conn.commit()
    except Exception as exc:  # pragma: no cover - 실패 시 로그만 남김
        logging.error("에러로그 저장 실패: %s", exc)


def fetch_rooms(conn, reference_date: dt.date) -> List[Room]:
    sql = """
        SELECT cr.id, cr.building_id, cr.room_no,
               cr.bed_count, cr.weight,
               cr.checkin_time, cr.checkout_time,
               cr.ical_url_1, cr.ical_url_2,
               eb.basecode_sector, eb.basecode_code, eb.building_name, eb.building_short_name
        FROM client_rooms cr
        JOIN etc_buildings eb ON eb.id = cr.building_id
        WHERE cr.open_yn = 1
    """
    with conn.cursor(dictionary=True) as cur:
        cur.execute(sql)
        rows = cur.fetchall()
    rooms: List[Room] = []
    for row in rows:
        urls = [u for u in (row["ical_url_1"], row["ical_url_2"]) if u]
        rooms.append(
            Room(
                id=row["id"],
                building_id=row["building_id"],
                sector=row["basecode_sector"],
                sector_value=row["basecode_code"],
                building_short_name=row.get("building_short_name", ""),
                building_name=row["building_name"],
                room_no=row["room_no"],
                bed_count=row["bed_count"],
                weight=row.get("weight", 10) or 0,
                checkin_time=row["checkin_time"],
                checkout_time=row["checkout_time"],
                ical_urls=urls,
            )
        )
    logging.info("활성 객실 %s건 로딩", len(rooms))
    return rooms


def fetch_apply_rules(conn) -> List[ApplyRule]:
    with conn.cursor(dictionary=True) as cur:
        cur.execute(
            """
            SELECT min_weight, max_weight, cleaner_count, butler_count, level_flag
            FROM work_apply_rules
            ORDER BY min_weight ASC
            """
        )
        rows = cur.fetchall()
    return [
        ApplyRule(
            min_weight=int(row["min_weight"]),
            max_weight=(int(row["max_weight"]) if row["max_weight"] is not None else None),
            cleaner_count=int(row["cleaner_count"]),
            butler_count=int(row["butler_count"]),
            level_flag=int(row["level_flag"]),
        )
        for row in rows
    ]


def fetch_sector_weights(
    predictions: Sequence[Prediction], target_date: dt.date
) -> List[Tuple[str, str, int]]:
    totals: Dict[Tuple[str, str], int] = {}
    for pred in predictions:
        if pred.target_date != target_date:
            continue
        if not pred.has_checkout:
            continue
        key = (pred.room.sector, pred.room.sector_value)
        totals[key] = totals.get(key, 0) + pred.room.weight

    return [(sector, value, weight) for (sector, value), weight in totals.items()]


def fetch_available_workers(conn, target_date: dt.date) -> List[WorkerAvailability]:
    weekday = (target_date.weekday() + 1) % 7  # Python Mon=0 → DB Sun=0
    with conn.cursor(dictionary=True) as cur:
        cur.execute(
            """
            SELECT w.id, w.tier,
                   EXISTS(
                       SELECT 1 FROM worker_schedule_exception e
                       WHERE e.worker_id = w.id AND e.excpt_date = %s AND e.cancel_work_yn = 1
                   ) AS has_cancel_exc,
                   EXISTS(
                       SELECT 1 FROM worker_schedule_exception e
                       WHERE e.worker_id = w.id AND e.excpt_date = %s AND e.add_work_yn = 1
                   ) AS has_add_exc,
                   EXISTS(
                       SELECT 1 FROM worker_weekly_pattern p
                       WHERE p.worker_id = w.id AND p.weekday = %s
                   ) AS has_weekly
            FROM worker_header w
            WHERE w.tier > 1
        """,
            (target_date, target_date, weekday),
        )
        rows = cur.fetchall()
    avail: List[WorkerAvailability] = []
    for row in rows:
        if row["has_cancel_exc"]:
            continue
        if not (row["has_add_exc"] or row["has_weekly"]):
            continue
        avail.append(
            WorkerAvailability(
                id=int(row["id"]),
                tier=int(row["tier"]),
                add_override=bool(row["has_add_exc"]),
                is_regular=bool(row["has_weekly"]),
            )
        )
    return avail


def _match_rule(weight: int, rules: List[ApplyRule]) -> Optional[ApplyRule]:
    for rule in rules:
        upper_ok = True if rule.max_weight is None else weight <= rule.max_weight
        if weight > rule.min_weight and upper_ok:
            return rule
    return None


def _pick_workers(candidates: List[WorkerAvailability], count: int, used: set[int]) -> List[WorkerAvailability]:
    selected: List[WorkerAvailability] = []
    for worker in sorted(
        candidates,
        key=lambda w: (
            -int(w.is_regular),
            -int(w.add_override),
            -w.tier,
            w.id,
        ),
    ):
        if worker.id in used:
            continue
        selected.append(worker)
        if len(selected) >= count:
            break
    return selected


# ------------------------------ ICS 처리 ------------------------------
def build_ics_filename(
    room: Room, url: str, existing: set[str], idx: int
) -> str:
    platform = "airbnb" if "airbnb" in url.lower() else "booking" if "booking" in url.lower() else "ics"
    base = f"{room.building_short_name}{room.room_no}_{platform}".replace(" ", "")
    safe = re.sub(r"[^A-Za-z0-9_-]", "", base) or f"room{room.id}_{platform}"
    name = safe
    counter = 2
    while name in existing:
        name = f"{safe}_{counter}"
        counter += 1
    existing.add(name)
    return name


def download_ics(url: str, dest_dir: Path, filename: str) -> Optional[Path]:
    try:
        response = requests.get(url, timeout=20)
        response.raise_for_status()
    except requests.RequestException as exc:
        logging.warning("ICS 다운로드 실패(%s): %s", url, exc)
        return None
    target = dest_dir / f"{filename}.ics"
    target.write_bytes(response.content)
    return target


def parse_events(path: Path) -> List[Event]:
    events: List[Event] = []
    try:
        calendar = Calendar.from_ical(path.read_bytes())
    except ValueError as exc:
        logging.warning("ICS 파싱 실패(%s): %s", path, exc)
        return events
    for component in calendar.walk("VEVENT"):
        try:
            start = to_aware(component.decoded("dtstart"))
            end = to_aware(component.decoded("dtend"))
        except Exception as exc:  # pylint: disable=broad-except
            logging.warning("VEVENT 파싱 실패(%s): %s", path, exc)
            continue
        events.append(Event(start=start, end=end))
    return events


def extract_out_time(events: Sequence[Event], target_date: dt.date) -> Optional[dt.time]:
    start_of_day = dt.datetime(target_date.year, target_date.month, target_date.day, tzinfo=SEOUL)
    end_of_day = start_of_day + dt.timedelta(days=1)
    for event in events:
        if start_of_day <= event.end <= end_of_day:
            return event.end.time()
    return None


def has_checkin_on(events: Sequence[Event], target_date: dt.date) -> bool:
    start_of_day = dt.datetime(target_date.year, target_date.month, target_date.day, tzinfo=SEOUL)
    end_of_day = start_of_day + dt.timedelta(days=1)
    for event in events:
        if start_of_day <= event.start < end_of_day:
            return True
    return False


# ------------------------------ 모델 계산 ------------------------------
def interpolate(value_d1: float, value_d7: float, horizon: int) -> float:
    ratio = (horizon - 1) / 6
    return (1 - ratio) * value_d1 + ratio * value_d7


def params_for_horizon(model: Dict[str, float], horizon: int) -> Tuple[float, float, float]:
    if horizon <= 1:
        return model["d1_alpha"], model["d1_beta"], model["d1_high"]
    if horizon >= 7:
        return model["d7_alpha"], model["d7_beta"], model["d7_high"]
    alpha = interpolate(model["d1_alpha"], model["d7_alpha"], horizon)
    beta = interpolate(model["d1_beta"], model["d7_beta"], horizon)
    high = interpolate(model["d1_high"], model["d7_high"], horizon)
    return alpha, beta, high


def compute_p_out(model: Dict[str, float], horizon: int, weekday: int) -> Tuple[float, float]:
    alpha, beta, high = params_for_horizon(model, horizon)
    base = WEEKDAY_BASE.get(weekday, 0.5)
    p_out = sigmoid(alpha + beta * base)
    if horizon == 1:
        p_out *= 0.6
    elif horizon >= 7:
        p_out *= 1.1
    p_out *= WEEKDAY_FACTOR.get(weekday, 1.0)
    return clamp(p_out), high


# ------------------------------ Batch Runner ------------------------------
class BatchRunner:
    def __init__(
        self,
        conn,
        run_date: dt.date,
        start_offset: int,
        end_offset: int,
        keep_days: int,
        today_only: bool,
    ) -> None:
        self.conn = conn
        self.run_date = run_date
        self.start_offset = start_offset
        self.end_offset = end_offset
        self.keep_days = keep_days
        self.model = load_model_variables(conn)
        self.today_only = today_only
        self.expected_ics = 0
        self.downloaded_ics = 0
        self._ics_names: set[str] = set()

    def run(self) -> None:
        rotate_ics_dirs(self.keep_days)
        ics_dir = ensure_ics_dir()
        rooms = fetch_rooms(self.conn, self.run_date)
        self.expected_ics = sum(len(r.ical_urls) for r in rooms)
        logging.info("ICS 기대 다운로드 수: %s", self.expected_ics)
        predictions: List[Prediction] = []
        offsets: List[int]
        if self.today_only:
            offsets = [0]
        else:
            offsets = sorted({0, *range(self.start_offset, self.end_offset + 1)})

        for room in rooms:
            events = self._collect_events(room, ics_dir)
            for offset in offsets:
                target_date = self.run_date + dt.timedelta(days=offset)
                out_time = extract_out_time(events, target_date)
                checkin_flag = has_checkin_on(events, target_date)
                p_out, high = compute_p_out(self.model, offset, target_date.weekday())
                borderline = self.model["borderline"]
                if p_out >= high:
                    label = "○"
                elif p_out >= borderline:
                    label = "△"
                else:
                    label = ""
                has_checkout = out_time is not None
                actual_observed = (target_date == self.run_date) and (not self.today_only)
                predictions.append(
                    Prediction(
                        room=room,
                        target_date=target_date,
                        horizon=offset,
                        out_time=out_time,
                        p_out=p_out,
                        label=label,
                        has_checkin=checkin_flag,
                        has_checkout=has_checkout,
                        actual_observed=actual_observed,
                    )
                )
        self._persist_predictions(predictions)
        self._persist_work_header(predictions)

        if not self.today_only:
            for offset in range(self.start_offset, self.end_offset + 1):
                self._persist_work_apply_slots(
                    self.run_date + dt.timedelta(days=offset), predictions
                )
            self._persist_accuracy(predictions)
            self._adjust_threshold(predictions)

        logging.info(
            "ICS 다운로드 결과: 기대 %s건 중 %s건", self.expected_ics, self.downloaded_ics
        )

    def _collect_events(self, room: Room, ics_dir: Path) -> List[Event]:
        events: List[Event] = []
        for idx, url in enumerate(room.ical_urls, start=1):
            base_name = build_ics_filename(room, url, self._ics_names, idx)
            path = download_ics(url, ics_dir, base_name)
            if not path:
                continue
            self.downloaded_ics += 1
            events.extend(parse_events(path))
        events.sort(key=lambda e: e.start)
        merged: List[Event] = []
        for event in events:
            if not merged:
                merged.append(event)
                continue
            last = merged[-1]
            if event.start < last.end:  # overlap → 병합 (back-to-back은 병합하지 않음)
                merged[-1] = Event(start=last.start, end=max(last.end, event.end))
            else:
                merged.append(event)
        return merged

    def _persist_predictions(self, predictions: Sequence[Prediction]) -> None:
        logging.info("예측 결과 %s건 DB 저장", len(predictions))
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM work_fore_d1 WHERE run_dttm=%s", (self.run_date,))
            cur.execute("DELETE FROM work_fore_d7 WHERE run_dttm=%s", (self.run_date,))
            for pred in predictions:
                table = "work_fore_d1" if pred.horizon <= 1 else "work_fore_d7"
                if pred.horizon not in (1, 7):
                    # 중간 horizon은 가장 가까운 테이블로 매핑
                    table = "work_fore_d1" if pred.horizon <= 3 else "work_fore_d7"
                cur.execute(
                    f"""
                    INSERT INTO {table}
                        (run_dttm, target_date, room_id, p_out, actual_out, correct)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        self.run_date,
                        pred.target_date,
                        pred.room.id,
                        round(pred.p_out, 3),
                        int(pred.has_checkout) if pred.actual_observed else 0,
                        int(pred.correct) if pred.actual_observed else 0,
                    ),
                )
        self.conn.commit()

    def _persist_work_apply_slots(
        self, target_date: dt.date, predictions: Sequence[Prediction]
    ) -> None:
        rules = fetch_apply_rules(self.conn)
        if not rules:
            logging.info("work_apply_rules 데이터가 없어 apply 생성이 스킵됩니다.")
            return
        sector_weights = fetch_sector_weights(predictions, target_date)
        if not sector_weights:
            logging.info("sector 가중치 합계가 없어 apply 생성이 스킵됩니다 (target=%s)", target_date)
            return

        existing_counts: Dict[Tuple[str, int], Tuple[int, int]] = {}
        with self.conn.cursor(dictionary=True) as cur:
            cur.execute(
                """
                SELECT basecode_sector, position,
                       COUNT(*) AS cnt, COALESCE(MAX(seq), 0) AS max_seq
                FROM work_apply
                WHERE work_date=%s
                GROUP BY basecode_sector, position
                """,
                (target_date,),
            )
            for row in cur.fetchall():
                key = (row["basecode_sector"], int(row["position"]))
                existing_counts[key] = (int(row["cnt"]), int(row["max_seq"]))

        with self.conn.cursor() as cur:
            for sector_code, sector_value, weight_sum in sector_weights:
                rule = _match_rule(weight_sum, rules)
                if not rule:
                    logging.info(
                        "해당 구간의 apply 규칙을 찾지 못해 건너뜁니다. sector=%s, weight=%s",
                        sector_code,
                        weight_sum,
                    )
                    continue

                for position, required in ((2, rule.butler_count), (1, rule.cleaner_count)):
                    key = (sector_code, position)
                    current_count, max_seq = existing_counts.get(key, (0, 0))
                    if current_count >= required:
                        continue

                    seq = max_seq
                    for _ in range(required - current_count):
                        seq += 1
                        if seq > 127:
                            raise ValueError(f"apply seq overflow for sector {sector_code}: {seq}")

                        cur.execute(
                            """
                            INSERT INTO work_apply
                                (work_date, basecode_sector, basecode_code, seq, position, worker_id)
                            VALUES (%s, %s, %s, %s, %s, NULL)
                            """,
                            (target_date, sector_code, sector_value, seq, position),
                        )
        self.conn.commit()

    def _persist_work_header(self, predictions: Sequence[Prediction]) -> None:
        target_date = self.run_date if self.today_only else self.run_date + dt.timedelta(days=1)
        desired_offset = 0 if self.today_only else 1
        entries: List[Tuple[Prediction, int, int]] = []
        for pred in predictions:
            if pred.horizon != desired_offset or pred.target_date != target_date:
                continue
            if pred.has_checkout:
                entries.append((pred, 0, 1))  # conditionCheckYn, cleaning_yn
            elif pred.has_checkin:
                entries.append((pred, 1, 0))

        if not entries:
            logging.info("work_header 대상 없음 (target=%s)", target_date)
            return

        existing_rooms: set[int] = set()
        with self.conn.cursor(dictionary=True) as cur:
            cur.execute("SELECT room_id FROM work_header WHERE date=%s", (target_date,))
            existing_rooms = {int(row["room_id"]) for row in cur.fetchall()}

        seen: set[int] = set(existing_rooms)
        to_insert: List[Tuple[Prediction, int, int]] = []
        for entry in entries:
            room_id = entry[0].room.id
            if room_id in seen:
                continue
            seen.add(room_id)
            to_insert.append(entry)

        if not to_insert:
            logging.info(
                "work_header 신규 삽입 대상이 없습니다 (target=%s, 기존 %s건)",
                target_date,
                len(existing_rooms),
            )
            return

        logging.info(
            "work_header 신규 삽입 (target=%s, 추가 %s건, 기존 %s건)",
            target_date,
            len(to_insert),
            len(existing_rooms),
        )
        with self.conn.cursor() as cur:
            for pred, condition_check, cleaning in to_insert:
                cur.execute(
                    """
                    INSERT INTO work_header
                        (date, room_id, cleaner_id, butler_id,
                         amenities_qty, blanket_qty, conditionCheckYn,
                         cleaning_yn, checkin_time, ceckout_time,
                         supply_yn, clening_flag, cleaning_end_time,
                         supervising_end_time, requirements, cancel_yn)
                    VALUES
                        (%s, %s, NULL, NULL,
                         %s, %s, %s,
                         %s, %s, %s,
                         0, 1, NULL,
                         NULL, NULL, 0)
                    """,
                    (
                        pred.target_date,
                        pred.room.id,
                        pred.room.bed_count,
                        pred.room.bed_count,
                        condition_check,
                        cleaning,
                        pred.room.checkin_time,
                        pred.room.checkout_time,
                    ),
                )
        self.conn.commit()

    def _persist_accuracy(self, predictions: Sequence[Prediction]) -> None:
        buckets: Dict[str, List[Prediction]] = {"D-1": [], "D-7": []}
        for pred in predictions:
            if not pred.actual_observed:
                continue
            if pred.horizon == 1:
                buckets["D-1"].append(pred)
            elif pred.horizon == 7:
                buckets["D-7"].append(pred)
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM work_fore_accuracy WHERE date=%s", (self.run_date,))
            for horizon, preds in buckets.items():
                if not preds:
                    continue
                total = len(preds)
                correct = sum(1 for p in preds if p.correct)
                predicted_positive = sum(1 for p in preds if p.predicted_positive)
                true_positive = sum(
                    1 for p in preds if p.predicted_positive and p.has_checkout
                )
                actual_positive = sum(1 for p in preds if p.has_checkout)
                acc = correct / total if total else 0
                prec = true_positive / predicted_positive if predicted_positive else 0
                rec = true_positive / actual_positive if actual_positive else 0
                f1 = (2 * prec * rec / (prec + rec)) if (prec + rec) else 0
                cur.execute(
                    """
                    INSERT INTO work_fore_accuracy
                        (date, horizon, acc, prec, rec, f1, n)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        self.run_date,
                        "D-1" if horizon == "D-1" else "D-7",
                        round(acc, 4),
                        round(prec, 4),
                        round(rec, 4),
                        round(f1, 4),
                        total,
                    ),
                )
        self.conn.commit()

    def _adjust_threshold(self, predictions: Sequence[Prediction]) -> None:
        d1_preds = [p for p in predictions if p.horizon == 1 and p.actual_observed]
        if not d1_preds:
            return
        predicted_positive = sum(1 for p in d1_preds if p.predicted_positive)
        if not predicted_positive:
            return
        true_positive = sum(
            1 for p in d1_preds if p.predicted_positive and p.has_checkout
        )
        precision = true_positive / predicted_positive
        before = self.model["d1_high"]
        after = before
        if precision < D1_PRECISION_TARGET - 0.05:
            after = clamp(before + D1_HIGH_STEP, D1_HIGH_MIN, D1_HIGH_MAX)
        elif precision > D1_PRECISION_TARGET + 0.05:
            after = clamp(before - D1_HIGH_STEP, D1_HIGH_MIN, D1_HIGH_MAX)
        if after == before:
            logging.info("컷오프 조정 불필요 (precision=%.2f)", precision)
            return
        self.model["d1_high"] = after
        save_model_variables(self.conn, self.model)
        logging.info("d1_high 조정: %.2f → %.2f (precision=%.2f)", before, after, precision)
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO work_fore_tuning
                    (`date`, `horizon`, `variable`, `before`, `after`, `delta`, `explanation`)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    self.run_date,
                    "D-1",
                    "d1_high",
                    round(before, 4),
                    round(after, 4),
                    round(after - before, 6),
                    f"precision={precision:.2f}",
                ),
            )
        self.conn.commit()


def main() -> None:
    configure_logging()
    args = parse_args()
    today_seoul = seoul_today()
    run_date = args.run_date or today_seoul
    if args.run_date and not args.allow_backfill and args.run_date != today_seoul:
        logging.warning(
            "입력 run-date %s가 현재 서울 날짜 %s와 달라 서울 날짜로 강제합니다. backfill 실행 시 --allow-backfill 사용",
            args.run_date,
            today_seoul,
        )
        run_date = today_seoul
    now_seoul = dt.datetime.now(dt.timezone.utc).astimezone(SEOUL)
    logging.info("기준일(KST): %s (현재 서울 시각 %s)", run_date, now_seoul.strftime("%Y-%m-%d %H:%M:%S"))
    conn = get_db_connection()
    try:
        runner = BatchRunner(
            conn=conn,
            run_date=run_date,
            start_offset=args.start_offset,
            end_offset=args.end_offset,
            keep_days=args.ics_keep_days,
            today_only=args.today_only,
        )
        runner.run()
    except Exception as exc:
        stack = traceback.format_exc()
        logging.error("배치 실행 실패", exc_info=exc)
        try:
            log_error(conn, message=str(exc), stacktrace=stack, run_date=run_date)
        except Exception:
            logging.error("에러로그 저장 중 추가 오류 발생", exc_info=True)
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()

