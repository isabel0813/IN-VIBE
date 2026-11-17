import asyncio
import json
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

from app import db, main, metrics, retention
from app.schemas import JudgeIn
from scripts.retention import main as command

NOW = datetime(2026, 11, 17, 10, tzinfo=db.KST)
CUTOFF = NOW - timedelta(days=30)


@pytest.fixture
def database(tmp_path, monkeypatch):
    path = tmp_path / "records.db"
    conn = db.connect(str(path))
    conn.close()
    monkeypatch.setattr(retention, "utc_now", lambda: NOW.astimezone(timezone.utc))
    monkeypatch.setattr(db, "now_kst", lambda: NOW)
    return path


def session(conn, user, created):
    return conn.execute("INSERT INTO sessions(user_id, task, started_at) VALUES (?, 'private task', ?)",
                        (user, created)).lastrowid


def judgment(conn, sid, created, key="video-key"):
    conn.execute("INSERT INTO video_judgments VALUES (?, ?, 'other', 'ai', 'private reason', ?)",
                 (sid, key, created))


def record(conn, table, user, created):
    if table == "tasks":
        conn.execute("INSERT INTO tasks(user_id,name,deadline,created_at) VALUES (?, 'private task', ?, ?)",
                     (user, (NOW + timedelta(days=2)).isoformat(), created))
    else:
        conn.execute("INSERT INTO events(user_id,type,created_at) VALUES (?, 'app_open', ?)", (user, created))


def count(conn, table):
    return conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]


def test_preview_does_not_modify_database_and_cascade_includes_recent_judgments(database):
    with sqlite3.connect(database) as conn:
        old = session(conn, "old", CUTOFF.isoformat())
        recent = session(conn, "recent", NOW.isoformat())
        judgment(conn, old, NOW.isoformat())
        judgment(conn, recent, (CUTOFF - timedelta(seconds=1)).isoformat())
        for table in ("events", "tasks"):
            record(conn, table, "old", CUTOFF.isoformat())
            record(conn, table, "recent", NOW.isoformat())
        conn.execute("INSERT INTO settings VALUES ('old', 120)")
    before = database.read_bytes()
    result = retention.run_once(database, "preview")
    assert result["counts"] == {"video_judgments": 2, "events": 1, "tasks": 1, "sessions": 1}
    assert database.read_bytes() == before
    result = retention.run_once(database, "apply")
    assert result["counts"]["video_judgments"] == 2
    with db.connect(str(database)) as conn:
        assert count(conn, "video_judgments") == 0
        assert count(conn, "sessions") == count(conn, "events") == count(conn, "tasks") == 1
        assert db.get_daily_minutes(conn, "old") == 120
        assert metrics.compute(db.all_events(conn), db.all_tasks(conn), NOW)["users"] == 1
        assert db.current_session(conn, "recent")["id"] == recent
    assert all(value == 0 for value in retention.run_once(database, "apply")["counts"].values())


def test_timezone_naive_kst_and_microsecond_boundary(database):
    timestamps = [CUTOFF.isoformat(), CUTOFF.astimezone(timezone.utc).isoformat(),
                  CUTOFF.replace(tzinfo=None).isoformat(),
                  (CUTOFF + timedelta(microseconds=1)).isoformat(), "invalid-date"]
    with sqlite3.connect(database) as conn:
        for stamp in timestamps:
            session(conn, "u", stamp)
    plan = retention.run_once(database, "apply")
    assert plan["counts"]["sessions"] == 3
    assert plan["invalid_dates"]["sessions"] == 1
    with sqlite3.connect(database) as conn:
        assert count(conn, "sessions") == 2


def test_recent_metrics_remain_valid_after_an_old_task_is_removed(database):
    conn = db.connect(str(database))
    task = db.create_task(conn, "u", "old task", NOW + timedelta(days=2))
    conn.execute("UPDATE tasks SET created_at=? WHERE id=?", (CUTOFF.isoformat(), task["id"]))
    conn.commit()
    db.log_event(conn, "u", "focus_started", task["id"])
    db.update_task(conn, "u", task["id"], done=True)
    conn.close()
    retention.run_once(database, "apply")
    conn = db.connect(str(database))
    result = metrics.compute(db.all_events(conn), db.all_tasks(conn), NOW)
    assert result["users"] == 1
    assert result["focus_sessions"]["started"] == 1
    assert result["tasks"]["done_on_time"]["rate"] is None
    json.dumps(result, allow_nan=False)
    assert db.planner_tasks(conn, "u") == []
    conn.close()


def test_legacy_database_gains_cascade_without_rebuilding_or_deleting_rows(tmp_path):
    path = tmp_path / "legacy.db"
    with sqlite3.connect(path) as conn:
        conn.executescript(db.SCHEMA.split("CREATE TRIGGER")[0])
        sid = session(conn, "u", NOW.isoformat())
        judgment(conn, sid, NOW.isoformat())
    conn = db.connect(str(path))
    assert count(conn, "video_judgments") == 1
    conn.execute("DELETE FROM sessions WHERE id=?", (sid,))
    conn.commit()
    assert count(conn, "video_judgments") == 0
    conn.close()


def test_correction_preserves_first_creation_and_deleted_parent_cannot_be_recreated(database, monkeypatch):
    conn = db.connect(str(database))
    s = db.start_session(conn, "u", "study")
    monkeypatch.setattr(db, "now_kst", lambda: CUTOFF)
    assert db.save_judgment(conn, s["id"], "key", "other", "ai")
    monkeypatch.setattr(db, "now_kst", lambda: NOW)
    assert db.save_judgment(conn, s["id"], "key", "user_ok", "user")
    assert conn.execute("SELECT created_at FROM video_judgments").fetchone()[0] == CUTOFF.isoformat()
    conn.execute("DELETE FROM sessions WHERE id=?", (s["id"],))
    conn.commit()
    assert not db.save_judgment(conn, s["id"], "late", "other", "ai", count_ai_call=True)
    assert count(conn, "video_judgments") == 0
    conn.close()


def test_late_api_judgment_after_deletion_returns_404_without_orphans(database, monkeypatch):
    conn = db.connect(str(database))
    s = db.start_session(conn, "u", "study")
    def reply(task, title):
        with sqlite3.connect(database) as other:
            other.execute("DELETE FROM sessions WHERE id=?", (s["id"],))
        return {"category": "other", "action": "ask", "reason": "mock"}
    monkeypatch.setattr(main.judge, "judge_title", reply)
    with pytest.raises(main.HTTPException) as error:
        main.judge_video(JudgeIn(session_id=s["id"], title="mock title"), user="u", conn=conn)
    assert error.value.status_code == 404
    assert count(conn, "video_judgments") == 0
    assert [e["type"] for e in db.all_events(conn)] == ["session_started"]
    conn.close()


def test_user_plan_removes_only_verified_user_including_settings(database, tmp_path, capsys):
    with sqlite3.connect(database) as conn:
        for user in ("private-user-one", "other-user"):
            sid = session(conn, user, NOW.isoformat())
            judgment(conn, sid, NOW.isoformat())
            record(conn, "tasks", user, NOW.isoformat())
            record(conn, "events", user, NOW.isoformat())
            conn.execute("INSERT INTO settings VALUES (?, 180)", (user,))
    identity = tmp_path / "user.txt"
    identity.write_text("private-user-one", encoding="utf-8")
    plan = tmp_path / "plan.json"
    base = ["--db", str(database), "--plan", str(plan), "--user-id-file", str(identity)]
    command(["preview", *base])
    assert "private-user-one" not in capsys.readouterr().out
    with pytest.raises(SystemExit):
        command(["apply", "--db", str(database), "--plan", str(plan)])
    command(["apply", *base])
    with db.connect(str(database)) as conn:
        assert all(count(conn, table) == 1 for table in retention.DELETE_ORDER)
        assert db.current_session(conn, "private-user-one") is None
        assert db.current_session(conn, "other-user") is not None
        assert db.get_daily_minutes(conn, "private-user-one") == db.DEFAULT_DAILY_MINUTES


def test_changed_targets_abort_apply_and_existing_backup_is_preserved(database, tmp_path):
    with sqlite3.connect(database) as conn:
        session(conn, "u", CUTOFF.isoformat())
    plan = tmp_path / "plan.json"
    command(["preview", "--db", str(database), "--plan", str(plan)])
    with sqlite3.connect(database) as conn:
        session(conn, "u", CUTOFF.isoformat())
    with pytest.raises(SystemExit):
        command(["apply", "--db", str(database), "--plan", str(plan)])
    with pytest.raises(FileExistsError):
        command(["preview", "--db", str(database), "--plan", str(plan)])
    fresh = tmp_path / "fresh.json"
    command(["preview", "--db", str(database), "--plan", str(fresh)])
    backup = tmp_path / "backup.db"
    backup.write_bytes(b"existing backup must remain")
    with pytest.raises(FileExistsError):
        command(["apply", "--db", str(database), "--plan", str(fresh), "--backup", str(backup)])
    assert backup.read_bytes() == b"existing backup must remain"
    with sqlite3.connect(database) as conn:
        assert count(conn, "sessions") == 2


def test_approved_cleanup_can_create_consistent_optional_backup(database, tmp_path):
    with sqlite3.connect(database) as conn:
        session(conn, "u", CUTOFF.isoformat())
    plan, backup = tmp_path / "plan.json", tmp_path / "backup.db"
    command(["preview", "--db", str(database), "--plan", str(plan)])
    command(["apply", "--db", str(database), "--plan", str(plan), "--backup", str(backup)])
    with sqlite3.connect(database) as conn, sqlite3.connect(backup) as saved:
        assert count(conn, "sessions") == 0
        assert count(saved, "sessions") == 1


def test_user_plan_cannot_target_another_user_or_database(database, tmp_path):
    with sqlite3.connect(database) as conn:
        session(conn, "user-one", NOW.isoformat())
        session(conn, "user-two", NOW.isoformat())
    identity = tmp_path / "user.txt"
    identity.write_text("user-one", encoding="utf-8")
    plan = tmp_path / "plan.json"
    command(["preview", "--db", str(database), "--plan", str(plan), "--user-id-file", str(identity)])
    identity.write_text("user-two", encoding="utf-8")
    with pytest.raises(SystemExit):
        command(["apply", "--db", str(database), "--plan", str(plan), "--user-id-file", str(identity)])
    other = tmp_path / "other.db"
    db.connect(str(other)).close()
    before = other.read_bytes()
    with pytest.raises(SystemExit):
        command(["apply", "--db", str(other), "--plan", str(plan), "--user-id-file", str(identity)])
    assert other.read_bytes() == before
    with sqlite3.connect(database) as conn:
        assert count(conn, "sessions") == 2


def test_failure_rolls_back_all_tables_and_secure_delete_is_enabled(database):
    with sqlite3.connect(database) as conn:
        sid = session(conn, "u", CUTOFF.isoformat())
        judgment(conn, sid, NOW.isoformat())
        record(conn, "events", "u", CUTOFF.isoformat())
        record(conn, "tasks", "u", CUTOFF.isoformat())
        conn.executescript("CREATE TRIGGER fail_delete BEFORE DELETE ON tasks BEGIN SELECT RAISE(ABORT, 'test failure'); END;")
    conn = retention.open_database(database, readonly=False)
    assert conn.execute("PRAGMA secure_delete").fetchone()[0] == 1
    plan = retention.make_plan(conn, database)
    with pytest.raises(sqlite3.IntegrityError):
        retention.apply_plan(conn, database, plan)
    assert all(count(conn, table) == 1 for table in retention.TABLE_DATES)
    conn.close()


def test_missing_database_is_not_created_and_future_cutoff_is_rejected(tmp_path, database):
    missing = tmp_path / "absent.db"
    assert retention.run_once(missing, "preview") == {"database_missing": True}
    assert not missing.exists()
    conn = retention.open_database(database)
    with pytest.raises(ValueError):
        retention.make_plan(conn, database, cutoff=NOW.isoformat())
    conn.close()


def test_lifespan_defaults_to_preview_and_catches_up_on_every_restart(database, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", str(database))
    monkeypatch.delenv("RETENTION_MODE", raising=False)
    with sqlite3.connect(database) as conn:
        session(conn, "u", CUTOFF.isoformat())
    async def start_once(expected):
        async with main.app.router.lifespan_context(main.app):
            with sqlite3.connect(database) as conn:
                assert count(conn, "sessions") == expected
    asyncio.run(start_once(1))
    monkeypatch.setenv("RETENTION_MODE", "apply")
    asyncio.run(start_once(0))
    with sqlite3.connect(database) as conn:
        session(conn, "u", CUTOFF.isoformat())
    asyncio.run(start_once(0))


def test_worker_retries_failure_and_stops_cleanly(database, monkeypatch):
    attempts = []
    async def scenario():
        stop, success = asyncio.Event(), asyncio.Event()
        loop = asyncio.get_running_loop()
        def once(path, mode):
            attempts.append(mode)
            if len(attempts) == 1:
                raise sqlite3.OperationalError("temporary test failure")
            loop.call_soon_threadsafe(success.set)
            return {"counts": {"sessions": 0}}
        monkeypatch.setattr(retention, "run_once", once)
        task = asyncio.create_task(retention.worker(database, "apply", stop, interval=0.01))
        await asyncio.wait_for(success.wait(), timeout=3)
        stop.set()
        await task
    asyncio.run(scenario())
    assert len(attempts) >= 2
