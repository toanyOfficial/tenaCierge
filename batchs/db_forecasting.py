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
import logging
import math
import os
from dataclasses import dataclass
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
    building_name: str
    room_no: str
    checkin_time: dt.time
    checkout_time: dt.time
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

    @property
    def actual_out(self) -> bool:
        return self.out_time is not None

    @property
    def predicted_positive(self) -> bool:
        return self.label == "○"

    @property
    def correct(self) -> bool:
        return (self.predicted_positive and self.actual_out) or (
            (not self.predicted_positive) and (not self.actual_out)
        )


# ------------------------------ 유틸 ------------------------------
def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="DB 기반 Forecasting 배치")
    parser.add_argument(
        "--run-date",
        type=lambda s: dt.datetime.strptime(s, "%Y-%m-%d").date(),
        default=dt.datetime.now(SEOUL).date(),
        help="배치 기준일 (기본: 오늘)",
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
    ensure_model_table(conn)
    values = DEFAULT_MODEL.copy()
    with conn.cursor(dictionary=True) as cur:
        cur.execute("SELECT name, value FROM model_variable")
        for row in cur.fetchall():
            values[row["name"]] = float(row["value"])
    logging.info("모델 변수 로딩 완료: %s", values)
    return values


def save_model_variables(conn, values: Dict[str, float]) -> None:
    ensure_model_table(conn)
    with conn.cursor() as cur:
        for name, value in values.items():
            cur.execute(
                """
                INSERT INTO model_variable(name, value)
                VALUES (%s, %s)
                ON DUPLICATE KEY UPDATE value=VALUES(value)
                """,
                (name, value),
            )
    conn.commit()


def fetch_rooms(conn, reference_date: dt.date) -> List[Room]:
    sql = """
        SELECT cr.id, cr.building_id, cr.room_no,
               cr.checkin_time, cr.checkout_time,
               cr.ical_url_1, cr.ical_url_2,
               eb.basecode_sector, eb.building_name
        FROM client_rooms cr
        JOIN etc_buildings eb ON eb.id = cr.building_id
        WHERE cr.start_date <= %s
          AND (cr.end_date IS NULL OR cr.end_date >= %s)
          AND (cr.ical_url_1 IS NOT NULL OR cr.ical_url_2 IS NOT NULL)
    """
    params = (reference_date, reference_date)
    with conn.cursor(dictionary=True) as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    rooms: List[Room] = []
    for row in rows:
        urls = [u for u in (row["ical_url_1"], row["ical_url_2"]) if u]
        if not urls:
            continue
        rooms.append(
            Room(
                id=row["id"],
                building_id=row["building_id"],
                sector=row["basecode_sector"],
                building_name=row["building_name"],
                room_no=row["room_no"],
                checkin_time=row["checkin_time"],
                checkout_time=row["checkout_time"],
                ical_urls=urls,
            )
        )
    logging.info("활성 객실 %s건 로딩", len(rooms))
    return rooms


# ------------------------------ ICS 처리 ------------------------------
def download_ics(url: str, dest_dir: Path) -> Optional[Path]:
    try:
        response = requests.get(url, timeout=20)
        response.raise_for_status()
    except requests.RequestException as exc:
        logging.warning("ICS 다운로드 실패(%s): %s", url, exc)
        return None
    filename = sanitize_filename(url)
    target = dest_dir / f"{filename}.ics"
    target.write_bytes(response.content)
    return target


def sanitize_filename(url: str) -> str:
    name = url.split("//")[-1].split("?")[0].replace("/", "_")
    return name[:100]


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
    ) -> None:
        self.conn = conn
        self.run_date = run_date
        self.start_offset = start_offset
        self.end_offset = end_offset
        self.keep_days = keep_days
        self.model = load_model_variables(conn)

    def run(self) -> None:
        rotate_ics_dirs(self.keep_days)
        ics_dir = ensure_ics_dir()
        rooms = fetch_rooms(self.conn, self.run_date)
        predictions: List[Prediction] = []
        for room in rooms:
            events = self._collect_events(room, ics_dir)
            for offset in range(self.start_offset, self.end_offset + 1):
                target_date = self.run_date + dt.timedelta(days=offset)
                out_time = extract_out_time(events, target_date)
                p_out, high = compute_p_out(self.model, offset, target_date.weekday())
                borderline = self.model["borderline"]
                if p_out >= high:
                    label = "○"
                elif p_out >= borderline:
                    label = "△"
                else:
                    label = ""
                predictions.append(
                    Prediction(
                        room=room,
                        target_date=target_date,
                        horizon=offset,
                        out_time=out_time,
                        p_out=p_out,
                        label=label,
                    )
                )
        self._persist_predictions(predictions)
        self._persist_work_header(predictions)
        self._persist_accuracy(predictions)
        self._adjust_threshold(predictions)

    def _collect_events(self, room: Room, ics_dir: Path) -> List[Event]:
        events: List[Event] = []
        for url in room.ical_urls:
            path = download_ics(url, ics_dir)
            if not path:
                continue
            events.extend(parse_events(path))
        events.sort(key=lambda e: e.end)
        merged: List[Event] = []
        for event in events:
            if not merged:
                merged.append(event)
                continue
            last = merged[-1]
            if event.start < last.end:  # overlap → 병합
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
                        int(pred.actual_out),
                        int(pred.correct),
                    ),
                )
        self.conn.commit()

    def _persist_work_header(self, predictions: Sequence[Prediction]) -> None:
        targets = [p for p in predictions if p.horizon == 1 and p.actual_out]
        if not targets:
            return
        logging.info("work_header 업데이트 (rows=%s)", len(targets))
        with self.conn.cursor() as cur:
            cur.execute(
                "DELETE FROM work_header WHERE date=%s",
                (self.run_date + dt.timedelta(days=1),),
            )
            for pred in targets:
                cur.execute(
                    """
                    INSERT INTO work_header
                        (date, room, cleaner_id, butler_id,
                         amenities_qty, blanket_qty, conditionCheckYn,
                         cleaning_yn, checkin_time, ceckout_time,
                         supply_yn, clening_flag, cleaning_end_time,
                         supervising_end_time, requirements, cancel_yn)
                    VALUES
                        (%s, %s, NULL, NULL,
                         %s, %s, %s,
                         %s, %s, %s,
                         %s, %s, NULL,
                         NULL, %s, %s)
                    """,
                    (
                        pred.target_date,
                        pred.room.id,
                        0,
                        0,
                        0,
                        1,
                        pred.room.checkin_time,
                        pred.room.checkout_time,
                        1,
                        1,
                        "AUTO-GENERATED",
                        0,
                    ),
                )
        self.conn.commit()

    def _persist_accuracy(self, predictions: Sequence[Prediction]) -> None:
        buckets: Dict[str, List[Prediction]] = {"D-1": [], "D-7": []}
        for pred in predictions:
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
                true_positive = sum(1 for p in preds if p.predicted_positive and p.actual_out)
                actual_positive = sum(1 for p in preds if p.actual_out)
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
        d1_preds = [p for p in predictions if p.horizon == 1]
        if not d1_preds:
            return
        predicted_positive = sum(1 for p in d1_preds if p.predicted_positive)
        if not predicted_positive:
            return
        true_positive = sum(1 for p in d1_preds if p.predicted_positive and p.actual_out)
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
                    (date, horizon, variable, before, after, delta, explanation)
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
    conn = get_db_connection()
    try:
        runner = BatchRunner(
            conn=conn,
            run_date=args.run_date,
            start_offset=args.start_offset,
            end_offset=args.end_offset,
            keep_days=args.ics_keep_days,
        )
        runner.run()
    finally:
        conn.close()


if __name__ == "__main__":
    main()

