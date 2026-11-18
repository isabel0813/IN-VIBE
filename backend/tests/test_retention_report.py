import hashlib
import json
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app import db, retention
from scripts.retention_report import build_report, normalized_time

NOW = datetime(2026, 11, 17, 20, tzinfo=db.KST)
CUTOFF = NOW - timedelta(days=30)


@pytest.fixture
def database(tmp_path):
    path = tmp_path / "records.db"
    db.connect(str(path)).close()
    return path


def test_counts_include_cascade_once_and_preserve_every_database_byte(database):
    with sqlite3.connect(database) as conn:
        for sid, stamp in [(1, CUTOFF), (2, NOW)]:
            conn.execute("INSERT INTO sessions(id,user_id,task,started_at) VALUES (?, 'private-id', 'private-task', ?)",
                         (sid, stamp.isoformat()))
        for sid, key, stamp in [(1, "old", CUTOFF), (1, "new", NOW), (2, "old", CUTOFF), (2, "new", NOW)]:
            conn.execute("INSERT INTO video_judgments VALUES (?, ?, 'other', 'ai', 'private-reason', ?)",
                         (sid, key, stamp.isoformat()))
        for stamp in (CUTOFF, NOW):
            conn.execute("INSERT INTO tasks(user_id,name,deadline,created_at) VALUES ('private-id', 'private-task', ?, ?)",
                         (NOW.isoformat(), stamp.isoformat()))
            conn.execute("INSERT INTO events(user_id,type,payload,created_at) VALUES ('private-id', 'app_open', 'private-payload', ?)",
                         (stamp.isoformat(),))
        conn.execute("INSERT INTO settings VALUES ('private-id', 300)")
    before = hashlib.sha256(database.read_bytes()).hexdigest()
    report = build_report(database, now=NOW)
    assert report["complete"]
    assert report["excluded_tables"] == ["settings"]
    assert "settings" not in report["tables"]
    for table in ("tasks", "sessions", "events"):
        assert report["tables"][table]["total"] == 2
        assert report["tables"][table]["delete_candidates_total"] == 1
    video = report["tables"]["video_judgments"]
    assert (video["total"], video["expired_by_age"], video["cascade_only"], video["delete_candidates_total"]) == (4, 2, 1, 3)
    assert report["tables"]["sessions"]["active_delete_candidates"] == 1
    with retention.open_database(database) as conn:
        plan = retention.make_plan(conn, database, now=NOW)
        assert plan["counts"] == {t: report["tables"][t]["delete_candidates_total"] for t in report["tables"]}
    assert hashlib.sha256(database.read_bytes()).hexdigest() == before
    output = json.dumps(report)
    for private in ("private-id", "private-task", "private-reason", "private-payload"):
        assert private not in output


def test_timezone_boundary_invalid_dates_and_orphans(database):
    with sqlite3.connect(database) as conn:
        for stamp in [CUTOFF.isoformat(), CUTOFF.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                      CUTOFF.replace(tzinfo=None).isoformat(), (CUTOFF + timedelta(microseconds=1)).isoformat(), "broken"]:
            conn.execute("INSERT INTO events(user_id,type,created_at) VALUES ('u', 'app_open', ?)", (stamp,))
        conn.execute("INSERT INTO video_judgments VALUES (999, 'orphan', 'other', 'ai', '', ?)", (NOW.isoformat(),))
    report = build_report(database, now=NOW)
    assert report["tables"]["events"]["expired_by_age"] == 3
    assert report["tables"]["events"]["invalid_dates"] == 1
    assert report["tables"]["video_judgments"]["orphaned_records"] == 1
    assert report["tables"]["video_judgments"]["delete_candidates_total"] == 0


def test_missing_tables_are_reported_as_unknown_and_no_schema_is_added(tmp_path):
    path = tmp_path / "partial.db"
    with sqlite3.connect(path) as conn:
        conn.execute("CREATE TABLE events(id INTEGER PRIMARY KEY, created_at TEXT)")
    before = path.read_bytes()
    report = build_report(path, now=NOW)
    assert not report["complete"]
    assert report["tables"]["sessions"]["total"] is None
    assert report["tables"]["video_judgments"]["delete_candidates_total"] is None
    assert report["tables"]["events"]["total"] == 0
    assert path.read_bytes() == before


def test_missing_file_is_not_created(tmp_path):
    path = tmp_path / "absent.db"
    with pytest.raises(FileNotFoundError):
        build_report(path)
    assert not path.exists()


def test_cascade_is_unknown_when_parent_schema_is_unavailable(tmp_path):
    path = tmp_path / "video-only.db"
    with sqlite3.connect(path) as conn:
        conn.execute("CREATE TABLE video_judgments(session_id INTEGER, created_at TEXT)")
        conn.execute("INSERT INTO video_judgments VALUES (1, ?)", (NOW.isoformat(),))
    report = build_report(path, now=NOW)
    video = report["tables"]["video_judgments"]
    assert video["total"] == 1 and video["expired_by_age"] == 0
    assert video["status"] == "cascade_unavailable"
    assert video["cascade_only"] is None and video["delete_candidates_total"] is None
    assert not report["complete"]


def test_script_runs_outside_application_without_credentials(database, tmp_path):
    script = Path(__file__).resolve().parents[1] / "scripts" / "retention_report.py"
    result = subprocess.run([sys.executable, str(script), "--db", str(database)], cwd=tmp_path,
                            text=True, capture_output=True, check=True)
    report = json.loads(result.stdout)
    assert report["complete"]
    assert all(row["total"] == 0 for row in report["tables"].values())
    assert result.stderr == ""


def test_consistent_wal_snapshot_sees_committed_data_without_checkpoint(database):
    conn = sqlite3.connect(database)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("INSERT INTO events(user_id,type,created_at) VALUES ('u', 'app_open', ?)", (NOW.isoformat(),))
        conn.commit()
        before = conn.execute("SELECT count(*) FROM events").fetchone()[0]
        report = build_report(database, now=NOW)
        assert report["tables"]["events"]["total"] == before == 1
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    finally:
        conn.close()


def test_timezone_normalization_matches_retention_implementation():
    for stamp in [NOW.isoformat(), CUTOFF.isoformat(), NOW.replace(tzinfo=None).isoformat(), "bad", None]:
        assert normalized_time(stamp) == retention.normalized_time(stamp)
