"""Standalone, aggregate-only SQLite report. Does not import or start the application."""
from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

TABLE_DATES = {"tasks": "created_at", "sessions": "started_at",
               "video_judgments": "created_at", "events": "created_at"}
KST = ZoneInfo("Asia/Seoul")


def normalized_time(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=KST)
        return parsed.astimezone(timezone.utc).isoformat(timespec="microseconds")
    except (AttributeError, TypeError, ValueError, OverflowError):
        return None


def build_report(path, *, now=None):
    resolved = Path(path).resolve(strict=True)
    if not resolved.is_file():
        raise ValueError("Expected an existing SQLite file")
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("Report time needs a timezone")
    cutoff = normalized_time((now - timedelta(days=30)).isoformat())
    report = {"report_version": 1, "database": str(resolved),
              "snapshot_at_utc": normalized_time(now.isoformat()), "cutoff_utc": cutoff,
              "retention_days": 30, "boundary": "created_time <= cutoff_utc",
              "excluded_tables": ["settings"], "complete": True, "tables": {}}
    conn = sqlite3.connect(f"{resolved.as_uri()}?mode=ro", uri=True, timeout=5)
    try:
        conn.execute("PRAGMA query_only = ON")
        conn.create_function("retention_report_time", 1, normalized_time, deterministic=True)
        conn.execute("BEGIN")
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        columns = {table: {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
                   for table in TABLE_DATES if table in tables}
        for table, date_column in TABLE_DATES.items():
            entry = {"total": None, "expired_by_age": None, "cascade_only": 0,
                     "delete_candidates_total": None, "invalid_dates": None}
            report["tables"][table] = entry
            if table not in tables:
                entry["status"] = "missing_table"
                report["complete"] = False
                continue
            entry["total"] = conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            if date_column not in columns[table]:
                entry["status"] = "missing_creation_column"
                report["complete"] = False
                continue
            age = f"retention_report_time({date_column}) <= ?"
            entry["expired_by_age"] = conn.execute(
                f"SELECT count(*) FROM {table} WHERE {age}", (cutoff,)).fetchone()[0]
            entry["invalid_dates"] = conn.execute(
                f"SELECT count(*) FROM {table} WHERE retention_report_time({date_column}) IS NULL").fetchone()[0]
            entry["delete_candidates_total"] = entry["expired_by_age"]
            entry["status"] = "ok"
            if table == "sessions" and "ended_at" in columns[table]:
                entry["active_delete_candidates"] = conn.execute(
                    f"SELECT count(*) FROM sessions WHERE {age} AND ended_at IS NULL", (cutoff,)).fetchone()[0]
            if table == "video_judgments":
                if not {"id", "started_at"}.issubset(columns.get("sessions", set())) or "session_id" not in columns[table]:
                    entry.update(status="cascade_unavailable", cascade_only=None, delete_candidates_total=None)
                    report["complete"] = False
                    continue
                cascade = "session_id IN (SELECT id FROM sessions WHERE retention_report_time(started_at) <= ?)"
                candidates = conn.execute(
                    f"SELECT count(*) FROM video_judgments WHERE {age} OR {cascade}", (cutoff, cutoff)).fetchone()[0]
                entry["delete_candidates_total"] = candidates
                entry["cascade_only"] = candidates - entry["expired_by_age"]
                entry["orphaned_records"] = conn.execute(
                    "SELECT count(*) FROM video_judgments v WHERE NOT EXISTS "
                    "(SELECT 1 FROM sessions s WHERE s.id=v.session_id)").fetchone()[0]
        return report
    finally:
        conn.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="Existing SQLite file, e.g. /data/mobonyong.db")
    args = parser.parse_args(argv)
    report = build_report(args.db)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["complete"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
