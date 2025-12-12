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


@dataclass(frozen=True)
class Event:
    """ICS 이벤트 구간(start/end)만을 표현하는 최소 모델."""

    start: dt.datetime
    end: dt.datetime

    def __init__(self, start: dt.datetime, end: dt.datetime):
        object.__setattr__(self, "start", start)
        object.__setattr__(self, "end", end)


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
        "--refresh-dn",
        type=int,
        default=None,
        help="지정한 D+n 일자에 대해 work_header만 갱신하는 경량 모드(예: --refresh-dn 1)",
    )
    args = parser.parse_args()

    return args


def get_db_connection(*, autocommit: bool = False) -> mysql.connector.MySQLConnection:
    cfg = dict(
        host=os.environ.get("DB_HOST", "127.0.0.1"),
        port=int(os.environ.get("DB_PORT", 3306)),
        user=os.environ.get("DB_USER", "root"),
        password=os.environ.get("DB_PASSWORD", ""),
        database=os.environ.get("DB_NAME", "tenaCierge"),
        autocommit=autocommit,
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
                INSERT INTO work_fore_variable(name, value, created_by, updated_by)
                VALUES (%s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE value=VALUES(value), updated_by=VALUES(updated_by)
                """,
                (name, value, "BATCH", "BATCH"),
            )
    conn.commit()


def log_error(
    conn: Optional[mysql.connector.MySQLConnection],
    *,
    message: str,
    stacktrace: Optional[str] = None,
    error_code: Optional[str] = None,
    level: int = 2,
    app_name: str = "db_forecasting",
    run_date: Optional[dt.date] = None,
) -> None:
    """etc_errorLogs 테이블에 오류 정보를 적재한다."""

    log_conn = conn if conn is not None and conn.is_connected() else get_db_connection(autocommit=True)
    should_close = log_conn is not conn
    try:
        context_json = json.dumps({"run_date": str(run_date or seoul_today())})
        with log_conn.cursor() as cur:
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
        log_conn.commit()
    except Exception as exc:  # pragma: no cover - 실패 시 로그만 남김
        logging.error("에러로그 저장 실패: %s", exc)
    finally:
        if should_close:
            log_conn.close()


def log_batch_execution(
    conn: Optional[mysql.connector.MySQLConnection],
    *,
    app_name: str,
    start_dttm: dt.datetime,
    end_dttm: dt.datetime,
    end_flag: int,
    context: Optional[Dict[str, object]] = None,
) -> None:
    """배치 실행 이력을 DB에 남긴다."""

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
    except Exception as exc:  # pragma: no cover - 실패 시 로그만 남김
        logging.error("배치 실행 로그 저장 실패: %s", exc)
    finally:
        if should_close:
            log_conn.close()


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
    seen_rooms: set[int] = set()
    for pred in predictions:
        if pred.target_date != target_date:
            continue
        if not pred.has_checkout:
            continue
        if pred.room.id in seen_rooms:
            continue
        seen_rooms.add(pred.room.id)
        key = (pred.room.sector, pred.room.sector_value)
        totals[key] = totals.get(key, 0) + pred.room.weight

    return [(sector, value, weight) for (sector, value), weight in totals.items()]


def fetch_sector_weights_from_headers(
    conn, target_date: dt.date
) -> List[Tuple[str, str, int]]:
    """work_header 기반 가중치 합계를 계산한다 (cleaning only, cancel 제외)."""

    sql = """
        SELECT eb.basecode_sector AS sector, eb.basecode_code AS code,
               SUM(COALESCE(cr.weight, 10)) AS weight_sum
        FROM work_header wh
        JOIN client_rooms cr ON cr.id = wh.room_id
        JOIN etc_buildings eb ON eb.id = cr.building_id
        WHERE wh.date = %s AND wh.cancel_yn = 0 AND wh.cleaning_yn = 1
        GROUP BY eb.basecode_sector, eb.basecode_code
    """
    with conn.cursor(dictionary=True) as cur:
        cur.execute(sql, (target_date,))
        rows = cur.fetchall()
    return [
        (row["sector"], row["code"], int(row.get("weight_sum") or 0)) for row in rows
        if row.get("weight_sum")
    ]


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
    raw_short = room.building_short_name or room.building_name or f"b{room.building_id}"
    # 한글 등 비ASCII 문자는 허용하고, 파일 시스템에 문제가 될 수 있는 최소한의 문자만 제거한다.
    safe_short = re.sub(r"[^\w-]", "", raw_short, flags=re.UNICODE)
    if not safe_short:
        safe_short = f"b{room.building_id}"
    safe = f"{safe_short}_{room.room_no}_{platform}".replace(" ", "")
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
    """Parse ICS and return merged VEVENT ranges (start/end only)."""

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
    for event in events:
        if event.end.date() == target_date:
            return event.end.time()
    return None


def has_checkin_on(events: Sequence[Event], target_date: dt.date) -> bool:
    for event in events:
        if event.start.date() == target_date:
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
        refresh_dn: Optional[int],
    ) -> None:
        self.conn = conn
        self.run_date = run_date
        self.start_offset = start_offset
        self.end_offset = end_offset
        self.keep_days = keep_days
        self.model = load_model_variables(conn)
        self.refresh_dn = refresh_dn
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
        if self.refresh_dn is not None:
            offsets = [self.refresh_dn]
        else:
            offsets = list(range(max(1, self.start_offset), self.end_offset + 1))

        # refresh 모드에서도 동일 offsets를 후속 단계에 그대로 사용하도록 보관한다.
        self.offsets = offsets

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
                actual_observed = target_date == self.run_date
                prediction = Prediction(
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
                predictions.append(prediction)
        if self.refresh_dn is None:
            self._persist_predictions(predictions)
        self._persist_work_header(predictions, offsets)

        if self.refresh_dn is not None:
            logging.info(
                "refresh-d%s 모드: work_header만 갱신하고 accuracy/apply는 건너뜀",
                self.refresh_dn,
            )
        else:
            for offset in range(self.start_offset, self.end_offset + 1):
                self._persist_work_apply_slots(
                    self.run_date + dt.timedelta(days=offset), predictions
                )

        logging.info(
            "ICS 다운로드 결과: 기대 %s건 중 %s건", self.expected_ics, self.downloaded_ics
        )

        if self.refresh_dn is not None:
            self._apply_work_reservation_overrides()

    def _collect_events(self, room: Room, ics_dir: Path) -> List[Event]:
        all_events: List[Event] = []
        for idx, url in enumerate(room.ical_urls, start=1):
            base_name = build_ics_filename(room, url, self._ics_names, idx)
            path = download_ics(url, ics_dir, base_name)
            if not path:
                continue
            self.downloaded_ics += 1
            raw_events = parse_events(path)
            raw_events.sort(key=lambda e: e.start)
            all_events.extend(raw_events)

        if not all_events:
            return []

        all_events.sort(key=lambda e: e.start)
        merged: List[Event] = []
        for event in all_events:
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
        """Persist forecast outputs."""

        logging.info("예측 결과 %s건 DB 저장", len(predictions))
        d1_rows: List[Tuple[dt.date, dt.date, int, float, int, int]] = []
        d7_rows: List[Tuple[dt.date, dt.date, int, float, int, int]] = []

        for pred in predictions:
            payload = (
                self.run_date,
                pred.target_date,
                pred.room.id,
                round(pred.p_out, 3),
                int(pred.has_checkout) if pred.actual_observed else 0,
                int(pred.correct) if pred.actual_observed else 0,
            )

            # 1일/7일 외 구간은 가장 가까운 테이블에 저장한다.
            if pred.horizon <= 3:
                d1_rows.append(payload)
            else:
                d7_rows.append(payload)

        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM work_fore_d1 WHERE run_dttm=%s", (self.run_date,))
            cur.execute("DELETE FROM work_fore_d7 WHERE run_dttm=%s", (self.run_date,))

            if d1_rows:
                cur.executemany(
                    "INSERT INTO work_fore_d1 "
                    "(run_dttm, target_date, room_id, p_out, actual_out, correct) "
                    "VALUES (%s, %s, %s, %s, %s, %s)",
                    d1_rows,
                )

            if d7_rows:
                cur.executemany(
                    "INSERT INTO work_fore_d7 "
                    "(run_dttm, target_date, room_id, p_out, actual_out, correct) "
                    "VALUES (%s, %s, %s, %s, %s, %s)",
                    d7_rows,
                )

        self.conn.commit()

    def _persist_work_apply_slots(
        self, target_date: dt.date, predictions: Sequence[Prediction]
    ) -> None:
        rules = fetch_apply_rules(self.conn)
        if not rules:
            logging.info("work_apply_rules 데이터가 없어 apply 생성이 스킵됩니다.")
            self._assign_workers_to_apply(target_date)
            return
        sector_weights = fetch_sector_weights_from_headers(self.conn, target_date)
        if not sector_weights:
            logging.info(
                "sector 가중치 합계가 없어 apply 생성이 스킵됩니다 (target=%s)",
                target_date,
            )
            self._assign_workers_to_apply(target_date)
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
        self._assign_workers_to_apply(target_date)

    def _assign_workers_to_apply(self, target_date: dt.date) -> None:
        weekday = (target_date.weekday() + 1) % 7
        with self.conn.cursor(dictionary=True) as cur:
            cur.execute(
                """
                SELECT id, basecode_sector, seq, worker_id
                FROM work_apply
                WHERE work_date=%s AND position=2
                ORDER BY basecode_sector ASC, seq ASC
                """,
                (target_date,),
            )
            apply_rows = cur.fetchall()

        if not apply_rows:
            return

        used_workers: set[int] = {
            int(row["worker_id"]) for row in apply_rows if row.get("worker_id")
        }

        weekly_workers: List[int] = []
        with self.conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT worker_id
                FROM worker_weekly_pattern
                WHERE weekday=%s
                ORDER BY worker_id DESC
                """,
                (weekday,),
            )
            weekly_workers = [int(row[0]) for row in cur.fetchall() if row[0] is not None]

        available_workers = [w.id for w in fetch_available_workers(self.conn, target_date)]
        available_workers.sort(reverse=True)

        worker_queue: List[int] = []
        for worker_id in weekly_workers + available_workers:
            if worker_id in used_workers:
                continue
            if worker_id in worker_queue:
                continue
            worker_queue.append(worker_id)

        if not worker_queue:
            logging.info("배정 가능한 worker가 없어 work_apply worker_id 업데이트를 건너뜁니다.")
            return

        def _sector_key(row: Dict) -> tuple:
            sector = row.get("basecode_sector")
            try:
                sector_val = int(sector)
            except (TypeError, ValueError):
                sector_val = math.inf
            return (sector_val, row.get("seq", 0))

        assigned = 0
        worker_idx = 0
        with self.conn.cursor() as cur:
            for row in sorted(apply_rows, key=_sector_key):
                if row.get("worker_id"):
                    continue
                if worker_idx >= len(worker_queue):
                    break
                worker_id = worker_queue[worker_idx]
                worker_idx += 1
                cur.execute(
                    "UPDATE work_apply SET worker_id=%s, updated_by=%s WHERE id=%s",
                    (worker_id, "BATCH", int(row["id"])),
                )
                assigned += 1

        if assigned:
            self.conn.commit()
            logging.info(
                "work_apply(worker) 배정 완료: date=%s, position=2, assigned=%s",
                target_date,
                assigned,
            )

    def _persist_work_header(
        self, predictions: Sequence[Prediction], offsets: Sequence[int]
    ) -> None:

        desired: Dict[dt.date, Dict[int, Tuple[Prediction, int, int]]] = {}
        for pred in predictions:
            offset = (pred.target_date - self.run_date).days
            if offset not in offsets:
                continue

            include_checkin = offset in (0, 1)
            if pred.has_checkout:
                desired.setdefault(pred.target_date, {})[pred.room.id] = (
                    pred,
                    0,
                    1,
                )
            if include_checkin and pred.has_checkin:
                room_entries = desired.setdefault(pred.target_date, {})
                # 동일 일자/객실에 대해 청소 작업을 우선 반영하고, 없을 때만 상태확인 작업을 기록한다.
                if pred.room.id not in room_entries:
                    room_entries[pred.room.id] = (
                        pred,
                        1,
                        0,
                    )

        if not desired:
            logging.info("work_header 생성/보정 대상 없음")
            return

        with self.conn.cursor(dictionary=True) as cur:
            for target_date, entries in desired.items():
                cur.execute(
                    """
                    SELECT id, room_id, cleaning_yn, cancel_yn, manual_upt_yn,
                           condition_check_yn, checkin_time, checkout_time,
                           amenities_qty, blanket_qty, requirements
                    FROM work_header
                    WHERE date=%s
                    """,
                    (target_date,),
                )
                existing_rows = cur.fetchall()
                existing_map: Dict[int, Dict] = {}
                for row in existing_rows:
                    room_id = int(row["room_id"])
                    if room_id not in existing_map:
                        existing_map[room_id] = row

                to_insert: List[Tuple[Prediction, int, int]] = []
                to_cancel: List[int] = []
                to_update: List[Tuple[int, int, int, int, dt.time, dt.time, Optional[str], int]] = []

                for room_id, entry in entries.items():
                    existing = existing_map.get(room_id)
                    if not existing:
                        to_insert.append(entry)
                        continue
                    if existing.get("manual_upt_yn") == 1:
                        continue

                    pred, condition_check, cleaning = entry
                    requirements_text = "상태확인" if condition_check else None
                    needs_update = False

                    if existing.get("cancel_yn"):
                        needs_update = True
                    if int(existing.get("cleaning_yn", -1)) != cleaning:
                        needs_update = True
                    if existing.get("condition_check_yn") != condition_check:
                        needs_update = True
                    if existing.get("checkin_time") != pred.room.checkin_time:
                        needs_update = True
                    if existing.get("checkout_time") != pred.room.checkout_time:
                        needs_update = True
                    if int(existing.get("amenities_qty") or 0) != pred.room.bed_count:
                        needs_update = True
                    if int(existing.get("blanket_qty") or 0) != pred.room.bed_count:
                        needs_update = True
                    if (existing.get("requirements") or None) != requirements_text:
                        needs_update = True

                    if needs_update:
                        to_update.append(
                            (
                                cleaning,
                                condition_check,
                                pred.room.bed_count,
                                pred.room.bed_count,
                                pred.room.checkin_time,
                                pred.room.checkout_time,
                                requirements_text,
                                "BATCH",
                                int(existing["id"]),
                            )
                        )

                for room_id, row in existing_map.items():
                    if room_id in entries:
                        continue
                    if row.get("manual_upt_yn") == 1:
                        continue
                    if not row.get("cancel_yn"):
                        to_cancel.append(int(row["id"]))

                if not (to_insert or to_cancel or to_update):
                    logging.info("work_header 변경 없음 (target=%s)", target_date)
                    continue

                logging.info(
                    "work_header 보정(target=%s): 신규 %s건, 취소 %s건, 수정 %s건",
                    target_date,
                    len(to_insert),
                    len(to_cancel),
                    len(to_update),
                )

                if to_cancel:
                    cur.executemany(
                        "UPDATE work_header SET cancel_yn=1, updated_by=%s WHERE id=%s",
                        [("BATCH", pk) for pk in to_cancel],
                    )
                if to_update:
                    cur.executemany(
                        """
                        UPDATE work_header
                        SET cleaning_yn=%s,
                            condition_check_yn=%s,
                            amenities_qty=%s,
                            blanket_qty=%s,
                            checkin_time=%s,
                            checkout_time=%s,
                            requirements=%s,
                            cancel_yn=0,
                            updated_by=%s
                        WHERE id=%s
                        """,
                        to_update,
                    )
                for pred, condition_check, cleaning in to_insert:
                    requirements_text = "상태확인" if condition_check else None
                    cur.execute(
                        """
                        INSERT INTO work_header
                            (date, room_id, cleaner_id, butler_id,
                             amenities_qty, blanket_qty, condition_check_yn,
                             cleaning_yn, checkin_time, checkout_time,
                             supply_yn, clening_flag, cleaning_end_time,
                             supervising_end_time, requirements, cancel_yn, manual_upt_yn)
                        VALUES
                            (%s, %s, NULL, NULL,
                             %s, %s, %s,
                             %s, %s, %s,
                             0, 1, NULL,
                             NULL, %s, 0, 0)
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
                            requirements_text,
                        ),
                    )
                self.conn.commit()

    def _apply_work_reservation_overrides(self) -> None:
        """Reflect open work_reservation rows into work_header on refresh runs."""

        if self.refresh_dn is None:
            return

        target_date = self.run_date + dt.timedelta(days=self.refresh_dn)
        logging.info(
            "work_reservation 반영 시도: target_date=%s, refresh-d%s",
            target_date,
            self.refresh_dn,
        )

        def _normalize(value: Optional[str]) -> Optional[str]:
            if value is None:
                return None
            text = str(value).strip()
            return text or None

        def _merge_requirements(
            base: Optional[str], incoming: Optional[str]
        ) -> Optional[str]:
            base_req = _normalize(base)
            incoming_req = _normalize(incoming)
            if base_req and incoming_req:
                merged = f"{base_req}+{incoming_req}"
            else:
                merged = incoming_req or base_req

            if merged and len(merged) > 30:
                merged = merged[:30]
            return merged

        with self.conn.cursor(dictionary=True) as cur:
            cur.execute(
                """
                SELECT id, room_id, amenities_qty, blanket_qty,
                       checkin_time, checkout_time, requirements
                  FROM work_reservation
                 WHERE reflect_yn = 0 AND cancel_yn = 0
                """
            )
            reservations = cur.fetchall()
            if not reservations:
                logging.info("반영 대기 work_reservation 없음")
                return

            cur.execute(
                """
                SELECT id, room_id, requirements, manual_upt_yn
                  FROM work_header
                 WHERE date = %s AND cancel_yn = 0
                """,
                (target_date,),
            )
            headers = cur.fetchall()
            header_map = {int(row["room_id"]): row for row in headers}

            updates: List[
                Tuple[int, int, dt.time, dt.time, Optional[str], int]
            ] = []
            reservations_to_mark: List[Tuple[int, int]] = []
            skipped_manual = 0

            for res in reservations:
                room_id = int(res["room_id"])
                header = header_map.get(room_id)
                if not header:
                    continue
                if int(header.get("manual_upt_yn") or 0):
                    skipped_manual += 1
                    continue

                merged_req = _merge_requirements(
                    header.get("requirements"), res.get("requirements")
                )
                updates.append(
                    (
                        int(res["amenities_qty"]),
                        int(res["blanket_qty"]),
                        res["checkin_time"],
                        res["checkout_time"],
                        merged_req,
                        "BATCH",
                        int(header["id"]),
                    )
                )
                reservations_to_mark.append((int(header["id"]), "BATCH", int(res["id"])))

            if not updates:
                logging.info(
                    "work_reservation 반영 대상 없음 (헤더 없음/수동 수정 건 %s건)",
                    skipped_manual,
                )
                return

            cur.executemany(
                """
                UPDATE work_header
                   SET amenities_qty = %s,
                       blanket_qty = %s,
                       checkin_time = %s,
                       checkout_time = %s,
                       requirements = %s,
                       updated_by = %s
                 WHERE id = %s
                """,
                updates,
            )
            cur.executemany(
                "UPDATE work_reservation SET work_id=%s, updated_by=%s, reflect_yn=1 WHERE id=%s",
                reservations_to_mark,
            )
            self.conn.commit()

            logging.info(
                "work_reservation 반영 완료: 업데이트 %s건, reflect 완료 %s건, 수동 수정 스킵 %s건",
                len(updates),
                len(reservations_to_mark),
                skipped_manual,
            )

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
    logging.info("배치 시작")
    args = parse_args()
    today_seoul = seoul_today()
    run_date = args.run_date or today_seoul
    now_seoul = dt.datetime.now(dt.timezone.utc).astimezone(SEOUL)
    logging.info("기준일(KST): %s (현재 서울 시각 %s)", run_date, now_seoul.strftime("%Y-%m-%d %H:%M:%S"))
    start_dttm = dt.datetime.now(dt.timezone.utc)
    conn: Optional[mysql.connector.MySQLConnection] = None
    conn = get_db_connection()
    end_flag = 1
    try:
        runner = BatchRunner(
            conn=conn,
            run_date=run_date,
            start_offset=args.start_offset,
            end_offset=args.end_offset,
            keep_days=args.ics_keep_days,
            refresh_dn=args.refresh_dn,
        )
        runner.run()
        logging.info("배치 정상 종료")
    except Exception as exc:
        end_flag = 2
        stack = traceback.format_exc()
        logging.error("배치 비정상 종료", exc_info=exc)
        try:
            conn.rollback()
        except Exception:
            logging.error("에러 발생 후 롤백 실패", exc_info=True)
        try:
            log_error(conn, message=str(exc), stacktrace=stack, run_date=run_date)
        except Exception:
            logging.error("에러로그 저장 중 추가 오류 발생", exc_info=True)
        raise
    finally:
        try:
            log_batch_execution(
                conn,
                app_name="db_forecasting",
                start_dttm=start_dttm,
                end_dttm=dt.datetime.now(dt.timezone.utc),
                end_flag=end_flag,
                context={
                    "run_date": str(run_date),
                    "start_offset": args.start_offset,
                    "end_offset": args.end_offset,
                    "refresh_dn": args.refresh_dn,
                },
            )
        except Exception:
            logging.error("배치 실행 로그 저장 실패", exc_info=True)
        if conn is not None and conn.is_connected():
            conn.close()


if __name__ == "__main__":
    main()

