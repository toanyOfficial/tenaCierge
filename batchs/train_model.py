#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""모델 파라미터 자동 학습(Shadow/Active) 스크립트.

- work_fore_d1 / work_fore_d7 테이블의 과거 실적을 읽어들여 로지스틱 회귀로
  alpha/beta를 재추정한다.
- D1 horizon은 precision 목표(기본 0.70)에 맞춰 컷오프(threshold)를 자동 탐색한다.
- 기본 모드는 Shadow Mode(추천치만 출력). --apply 옵션 사용 시 model_variable
  테이블과 work_fore_tuning 로그를 갱신한다.
"""

from __future__ import annotations

import argparse
import datetime as dt
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Sequence, Tuple

import mysql.connector

from db_forecasting import (
    D1_PRECISION_TARGET,
    WEEKDAY_BASE,
    clamp,
    ensure_model_table,
    get_db_connection,
    load_model_variables,
    save_model_variables,
    sigmoid,
)


@dataclass
class TrainingSample:
    weekday_score: float
    label: int
    run_date: dt.date
    target_date: dt.date


@dataclass
class ThresholdMetrics:
    threshold: float
    precision: float
    recall: float
    accuracy: float
    positives: int


@dataclass
class ParameterUpdate:
    name: str
    before: float
    after: float
    explanation: str
    horizon: str

    @property
    def delta(self) -> float:
        return self.after - self.before


def configure_logging() -> None:
    base_dir = Path(__file__).resolve().parent
    log_path = base_dir / "train_model.log"
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
    parser = argparse.ArgumentParser(description="Forecasting 모델 자동 학습")
    parser.add_argument(
        "--days",
        type=int,
        default=45,
        help="학습에 사용할 과거 일수 (기본 45일)",
    )
    parser.add_argument(
        "--horizon",
        choices=["d1", "d7", "both"],
        default="both",
        help="학습 대상 horizon",
    )
    parser.add_argument(
        "--learning-rate",
        type=float,
        default=0.05,
        help="로지스틱 회귀 학습률",
    )
    parser.add_argument(
        "--epochs",
        type=int,
        default=400,
        help="최대 학습 epoch",
    )
    parser.add_argument(
        "--min-samples",
        type=int,
        default=120,
        help="학습을 수행하기 위한 최소 샘플 수",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="추천값을 model_variable/work_fore_tuning에 즉시 반영",
    )
    parser.add_argument(
        "--target-precision",
        type=float,
        default=D1_PRECISION_TARGET,
        help="D1 컷오프 탐색 시 목표 precision",
    )
    return parser.parse_args()


def fetch_samples(conn, table: str, days: int) -> List[TrainingSample]:
    since = dt.date.today() - dt.timedelta(days=days)
    sql = f"""
        SELECT run_dttm, target_date, actual_out
        FROM {table}
        WHERE run_dttm >= %s
          AND actual_out IS NOT NULL
    """
    samples: List[TrainingSample] = []
    with conn.cursor(dictionary=True) as cur:
        cur.execute(sql, (since,))
        for row in cur.fetchall():
            target_date = row["target_date"]
            weekday = target_date.weekday()
            samples.append(
                TrainingSample(
                    weekday_score=WEEKDAY_BASE.get(weekday, 0.5),
                    label=int(row["actual_out"]),
                    run_date=row["run_dttm"],
                    target_date=target_date,
                )
            )
    return samples


def logistic_regression(
    samples: Sequence[TrainingSample],
    alpha: float,
    beta: float,
    learning_rate: float,
    epochs: int,
) -> Tuple[float, float]:
    if not samples:
        return alpha, beta
    for _ in range(epochs):
        grad_a = 0.0
        grad_b = 0.0
        for sample in samples:
            z = alpha + beta * sample.weekday_score
            pred = sigmoid(z)
            diff = pred - sample.label
            grad_a += diff
            grad_b += diff * sample.weekday_score
        grad_a /= len(samples)
        grad_b /= len(samples)
        alpha -= learning_rate * grad_a
        beta -= learning_rate * grad_b
        if abs(grad_a) < 1e-5 and abs(grad_b) < 1e-5:
            break
    return alpha, beta


def evaluate_threshold(
    samples: Sequence[TrainingSample],
    alpha: float,
    beta: float,
    threshold: float,
) -> ThresholdMetrics:
    if not samples:
        return ThresholdMetrics(threshold, 0.0, 0.0, 0.0, 0)
    tp = fp = tn = fn = 0
    for sample in samples:
        pred_prob = sigmoid(alpha + beta * sample.weekday_score)
        predicted = pred_prob >= threshold
        if predicted and sample.label:
            tp += 1
        elif predicted and not sample.label:
            fp += 1
        elif (not predicted) and sample.label:
            fn += 1
        else:
            tn += 1
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    accuracy = (tp + tn) / (tp + tn + fp + fn) if (tp + tn + fp + fn) else 0.0
    return ThresholdMetrics(threshold, precision, recall, accuracy, tp + fp)


def search_threshold(
    samples: Sequence[TrainingSample],
    alpha: float,
    beta: float,
    target_precision: float,
    default_threshold: float,
) -> ThresholdMetrics:
    grid = [round(x / 100, 2) for x in range(30, 90)]
    best: ThresholdMetrics | None = None
    for thr in grid:
        metrics = evaluate_threshold(samples, alpha, beta, thr)
        if metrics.precision >= target_precision:
            if not best or metrics.precision < best.precision:
                best = metrics
    if best:
        return best
    fallback = evaluate_threshold(samples, alpha, beta, default_threshold)
    return fallback


def log_updates(conn, run_date: dt.date, updates: Sequence[ParameterUpdate]) -> None:
    if not updates:
        return
    with conn.cursor() as cur:
        for upd in updates:
            cur.execute(
                """
                INSERT INTO work_fore_tuning
                    (date, horizon, variable, before, after, delta, explanation)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    run_date,
                    upd.horizon,
                    upd.name,
                    round(upd.before, 4),
                    round(upd.after, 4),
                    round(upd.after - upd.before, 6),
                    upd.explanation,
                ),
            )
    conn.commit()


def apply_updates(conn, model: Dict[str, float], updates: Sequence[ParameterUpdate]) -> None:
    if not updates:
        logging.info("반영할 업데이트가 없습니다.")
        return
    for upd in updates:
        model[upd.name] = upd.after
    save_model_variables(conn, model)
    log_updates(conn, dt.date.today(), updates)
    logging.info("%s개 변수 갱신 완료", len(updates))


def log_shadow_suggestions(updates: Sequence[ParameterUpdate]) -> None:
    if not updates:
        return
    logging.info("Shadow Mode 제안 요약")
    logging.info("%-8s %-12s %-12s %-12s %s", "horizon", "name", "before", "after", "memo")
    for upd in updates:
        logging.info(
            "%-8s %-12s %-.4f %-.4f %s",
            upd.horizon,
            upd.name,
            upd.before,
            upd.after,
            upd.explanation,
        )


class ModelTrainer:
    def __init__(
        self,
        conn: mysql.connector.MySQLConnection,
        horizon: str,
        days: int,
        min_samples: int,
        learning_rate: float,
        epochs: int,
        target_precision: float,
        apply_changes: bool,
    ) -> None:
        self.conn = conn
        self.horizon = horizon
        self.days = days
        self.min_samples = min_samples
        self.learning_rate = learning_rate
        self.epochs = epochs
        self.target_precision = target_precision
        self.apply_changes = apply_changes
        self.model = load_model_variables(conn)

    def run(self) -> None:
        updates: List[ParameterUpdate] = []
        if self.horizon in ("d1", "both"):
            updates.extend(self._train_d1())
        if self.horizon in ("d7", "both"):
            updates.extend(self._train_d7())
        if self.apply_changes and updates:
            apply_updates(self.conn, self.model, updates)
        elif updates:
            log_shadow_suggestions(updates)
        else:
            logging.info("적용할 제안이 없습니다.")

    def _train_d1(self) -> List[ParameterUpdate]:
        samples = fetch_samples(self.conn, "work_fore_d1", self.days)
        logging.info("D1 학습 샘플 %s건", len(samples))
        if len(samples) < self.min_samples:
            logging.warning("D1 샘플 부족(%s < %s)으로 학습을 건너뜁니다.", len(samples), self.min_samples)
            return []
        alpha0 = self.model.get("d1_alpha", 0.0)
        beta0 = self.model.get("d1_beta", 1.0)
        alpha, beta = logistic_regression(samples, alpha0, beta0, self.learning_rate, self.epochs)
        updates = [
            ParameterUpdate(
                name="d1_alpha",
                before=alpha0,
                after=round(alpha, 6),
                explanation=f"samples={len(samples)}",
                horizon="D-1",
            ),
            ParameterUpdate(
                name="d1_beta",
                before=beta0,
                after=round(beta, 6),
                explanation=f"samples={len(samples)}",
                horizon="D-1",
            ),
        ]
        threshold_metrics = search_threshold(
            samples,
            alpha,
            beta,
            self.target_precision,
            default_threshold=self.model.get("d1_high", 0.5),
        )
        updates.append(
            ParameterUpdate(
                name="d1_high",
                before=self.model.get("d1_high", 0.5),
                after=clamp(round(threshold_metrics.threshold, 4), 0.3, 0.9),
                explanation=(
                    f"precision={threshold_metrics.precision:.2f} "
                    f"recall={threshold_metrics.recall:.2f} "
                    f"acc={threshold_metrics.accuracy:.2f}"
                ),
                horizon="D-1",
            )
        )
        for upd in updates:
            logging.info("D1 %s: %.4f → %.4f (%s)", upd.name, upd.before, upd.after, upd.explanation)
        return updates

    def _train_d7(self) -> List[ParameterUpdate]:
        samples = fetch_samples(self.conn, "work_fore_d7", self.days)
        logging.info("D7 학습 샘플 %s건", len(samples))
        if len(samples) < self.min_samples:
            logging.warning("D7 샘플 부족(%s < %s)으로 학습을 건너뜁니다.", len(samples), self.min_samples)
            return []
        alpha0 = self.model.get("d7_alpha", 0.0)
        beta0 = self.model.get("d7_beta", 1.0)
        alpha, beta = logistic_regression(samples, alpha0, beta0, self.learning_rate, self.epochs)
        updates = [
            ParameterUpdate(
                name="d7_alpha",
                before=alpha0,
                after=round(alpha, 6),
                explanation=f"samples={len(samples)}",
                horizon="D-7",
            ),
            ParameterUpdate(
                name="d7_beta",
                before=beta0,
                after=round(beta, 6),
                explanation=f"samples={len(samples)}",
                horizon="D-7",
            ),
        ]
        logging.info("D7 파라미터 제안: %s", updates)
        return updates


def main() -> None:
    configure_logging()
    args = parse_args()
    conn = get_db_connection()
    logging.info("모델 학습 배치 시작")
    try:
        ensure_model_table(conn)
        trainer = ModelTrainer(
            conn=conn,
            horizon=args.horizon,
            days=args.days,
            min_samples=args.min_samples,
            learning_rate=args.learning_rate,
            epochs=args.epochs,
            target_precision=args.target_precision,
            apply_changes=args.apply,
        )
        trainer.run()
        logging.info("모델 학습 배치 정상 종료")
    except Exception as exc:
        logging.error("모델 학습 배치 비정상 종료", exc_info=exc)
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
