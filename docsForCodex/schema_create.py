import csv
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple
from urllib.parse import urlparse

import mysql.connector

SCHEMA_FILE = Path(__file__).with_name("schema.csv")
SUMMARY_FILE = Path(__file__).with_name("schema_summary.md")

SchemaRow = Dict[str, str]


def load_existing_schema() -> Dict[Tuple[str, str], SchemaRow]:
    if not SCHEMA_FILE.exists():
        return {}

    with SCHEMA_FILE.open("r", encoding="utf-8") as fp:
        reader = csv.DictReader(fp)
        return {
            (row["table_name"], row["column_name"]): row
            for row in reader
        }


def parse_db_config() -> Dict[str, str]:
    url = os.getenv("DATABASE_URL")
    if url:
        parsed = urlparse(url)
        return {
            "host": parsed.hostname or "localhost",
            "port": parsed.port or 3306,
            "user": parsed.username or "root",
            "password": parsed.password or "",
            "database": (parsed.path or "/").lstrip("/"),
        }

    host = os.getenv("DB_HOST")
    user = os.getenv("DB_USER")
    password = os.getenv("DB_PASSWORD", "")
    database = os.getenv("DB_NAME")
    port = int(os.getenv("DB_PORT", "3306"))

    if not host or not user or not database:
        raise RuntimeError(
            "DB 연결정보가 없습니다. DATABASE_URL 또는 DB_HOST/DB_USER/DB_PASSWORD/DB_NAME 환경변수를 설정해 주세요.")

    return {"host": host, "user": user, "password": password, "database": database, "port": port}


def fetch_schema_rows(conn) -> List[SchemaRow]:
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT DATABASE() AS db")
    schema_row = cursor.fetchone()
    table_schema = schema_row.get("db") if schema_row else None

    query = (
        "SELECT table_schema, table_name, column_name, column_type AS data_type, "
        "is_nullable, column_comment "
        "FROM information_schema.columns "
        "WHERE table_schema = %s "
        "ORDER BY table_name, ordinal_position"
    )
    cursor.execute(query, (table_schema,))
    rows = cursor.fetchall()
    cursor.close()

    return [
        {
            "table_schema": row["table_schema"],
            "table_name": row["table_name"],
            "column_name": row["column_name"],
            "data_type": row["data_type"],
            "is_nullable": row["is_nullable"],
            "column_comment": row.get("column_comment") or "",
        }
        for row in rows
    ]


def write_schema(rows: List[SchemaRow]) -> None:
    headers = ["table_schema", "table_name", "column_name", "data_type", "is_nullable", "column_comment"]
    with SCHEMA_FILE.open("w", encoding="utf-8", newline="") as fp:
        writer = csv.DictWriter(fp, fieldnames=headers)
        writer.writeheader()
        for row in rows:
            writer.writerow({h: row.get(h, "") for h in headers})


def diff_schema(old: Dict[Tuple[str, str], SchemaRow], new: List[SchemaRow]):
    new_map = {(row["table_name"], row["column_name"]): row for row in new}

    added = [k for k in new_map.keys() if k not in old]
    removed = [k for k in old.keys() if k not in new_map]

    changed = []
    for key, new_row in new_map.items():
        if key not in old:
            continue
        old_row = old[key]
        if any(
            new_row.get(field, "").strip() != old_row.get(field, "").strip()
            for field in ("data_type", "is_nullable", "column_comment")
        ):
            changed.append((key, old_row, new_row))

    return added, removed, changed


def format_change_summary(added, removed, changed, rows: List[SchemaRow]) -> str:
    today = datetime.now().strftime("%Y-%m-%d")

    lines = [f"## {today} 스키마 변경 요약"]

    if not added and not removed and not changed:
        lines.append("- 기존 스키마와의 차이가 없습니다.")
    else:
        if added:
            sample = ", ".join([f"{t}.{c}" for (t, c) in added[:5]])
            extra = "" if len(added) <= 5 else f" 외 {len(added) - 5}건"
            lines.append(f"- 추가된 컬럼: {sample}{extra}")
        if removed:
            sample = ", ".join([f"{t}.{c}" for (t, c) in removed[:5]])
            extra = "" if len(removed) <= 5 else f" 외 {len(removed) - 5}건"
            lines.append(f"- 제거된 컬럼: {sample}{extra}")
        if changed:
            samples = []
            for (t, c), old_row, new_row in changed[:5]:
                samples.append(
                    f"{t}.{c}: {old_row.get('data_type')} -> {new_row.get('data_type')}"
                )
            extra = "" if len(changed) <= 5 else f" 외 {len(changed) - 5}건"
            lines.append(f"- 변경된 컬럼: {', '.join(samples)}{extra}")

    total_tables = len({row["table_name"] for row in rows})
    lines.append(f"- 테이블 수: {total_tables}개, 컬럼 수: {len(rows)}개")
    lines.append("")

    existing = SUMMARY_FILE.read_text(encoding="utf-8") if SUMMARY_FILE.exists() else ""
    return "\n".join(lines) + ("\n" + existing if existing else "")


def main():
    config = parse_db_config()
    conn = mysql.connector.connect(**config)
    try:
        new_rows = fetch_schema_rows(conn)
    finally:
        conn.close()

    existing_schema = load_existing_schema()
    added, removed, changed = diff_schema(existing_schema, new_rows)

    write_schema(new_rows)

    summary = format_change_summary(added, removed, changed, new_rows)
    SUMMARY_FILE.write_text(summary, encoding="utf-8")

    print("스키마 파일이 생성되었습니다:", SCHEMA_FILE)
    print("변경 요약:")
    print(summary.split("\n")[0])


if __name__ == "__main__":
    main()
