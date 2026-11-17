"""Count-only previews and transactional 30-day cleanup. No API/AI calls."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import db

RETENTION_DAYS = 30
INTERVAL_SECONDS = 60
TABLE_DATES = {"sessions": "started_at", "video_judgments": "created_at",
               "events": "created_at", "tasks": "created_at"}
DELETE_ORDER = ("video_judgments", "events", "tasks", "sessions", "settings")
logger = logging.getLogger("uvicorn.error")


def utc_now():
    return datetime.now(timezone.utc)


def normalized_time(value):
    try:
        parsed = datetime.fromisoformat(value)
        return db.to_kst(parsed).astimezone(timezone.utc).isoformat(timespec="microseconds")
    except (TypeError, ValueError, OverflowError):
        return None


def open_database(path, *, readonly=True):
    """Never create a missing DB or migrate it merely to preview/delete records."""
    resolved = Path(path).resolve(strict=True)
    if not resolved.is_file():
        raise ValueError("Database must be an existing file")
    mode = "ro" if readonly else "rw"
    conn = sqlite3.connect(f"{resolved.as_uri()}?mode={mode}", uri=True, timeout=30)
    conn.create_function("retention_time", 1, normalized_time, deterministic=True)
    if not readonly:
        conn.execute("PRAGMA secure_delete = ON")
    return conn


def _targets(conn, cutoff, user):
    present = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    targets = {}
    for table in DELETE_ORDER:
        if table not in present or (table == "settings" and user is None):
            continue
        if user is not None:
            if table == "video_judgments":
                if "sessions" not in present:
                    continue
                where = "session_id IN (SELECT id FROM sessions WHERE user_id = ?)"
            else:
                where = "user_id = ?"
            args = (user,)
        else:
            where = f"retention_time({TABLE_DATES[table]}) <= ?"
            args = (cutoff,)
            if table == "video_judgments" and "sessions" in present:
                where += " OR session_id IN (SELECT id FROM sessions WHERE retention_time(started_at) <= ?)"
                args += (cutoff,)
        targets[table] = (where, args)
    return targets


def make_plan(conn, path, *, cutoff=None, user=None, now=None):
    """A fingerprint binds approval to this file and the exact target row set."""
    if user is not None and (not user or len(user) > 64 or "\n" in user or "\r" in user):
        raise ValueError("Invalid user identifier")
    now = now or utc_now()
    limit = now - timedelta(days=RETENTION_DAYS)
    cutoff = normalized_time(cutoff or limit.isoformat()) if user is None else None
    if user is None and (cutoff is None or cutoff > normalized_time(limit.isoformat())):
        raise ValueError("Cutoff must be at least 30 days ago")
    resolved = Path(path).resolve(strict=True)
    stat = resolved.stat()
    plan = {"version": 1, "database": str(resolved), "scope": "user" if user is not None else "retention",
            "cutoff_utc": cutoff, "user_digest": hashlib.sha256(user.encode()).hexdigest() if user is not None else None,
            "file_identity": [stat.st_dev, stat.st_ino], "counts": {}, "invalid_dates": {}}
    digest = hashlib.sha256(json.dumps(plan, sort_keys=True).encode())
    targets = _targets(conn, cutoff, user)
    for table, (where, args) in targets.items():
        count = 0
        # Hash only row identifiers, never task names, titles, or event payloads.
        for row in conn.execute(f"SELECT rowid FROM {table} WHERE {where} ORDER BY rowid", args):
            digest.update(f"{table}:{row[0]}\n".encode())
            count += 1
        plan["counts"][table] = count
        if table in TABLE_DATES:
            column = TABLE_DATES[table]
            plan["invalid_dates"][table] = conn.execute(
                f"SELECT count(*) FROM {table} WHERE retention_time({column}) IS NULL").fetchone()[0]
    plan["fingerprint"] = digest.hexdigest()
    plan["settings_policy"] = "user_request_only"
    return plan


def apply_plan(conn, path, plan, *, user=None, now=None):
    """Recheck approved targets under a write lock; roll back the entire deletion on failure."""
    if conn.in_transaction:
        raise ValueError("Cleanup needs a dedicated connection")
    conn.execute("BEGIN IMMEDIATE")
    try:
        actual = make_plan(conn, path, cutoff=plan["cutoff_utc"], user=user, now=now)
        if actual != plan:
            raise ValueError("Deletion plan changed; preview and obtain approval again")
        for table, (where, args) in _targets(conn, plan["cutoff_utc"], user).items():
            conn.execute(f"DELETE FROM {table} WHERE {where}", args)
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    return actual["counts"]


def run_once(path, mode):
    if mode not in {"preview", "apply"}:
        raise ValueError("Unknown retention mode")
    if not Path(path).is_file():
        return {"database_missing": True}
    conn = open_database(path, readonly=mode != "apply")
    try:
        plan = make_plan(conn, path)
        if mode == "apply":
            apply_plan(conn, path, plan)
        return {"mode": mode, "cutoff_utc": plan["cutoff_utc"], "counts": plan["counts"],
                "invalid_dates": plan["invalid_dates"]}
    finally:
        conn.close()


async def run_logged(path, mode):
    try:
        result = await asyncio.to_thread(run_once, path, mode)
        logger.info("retention %s", json.dumps(result, sort_keys=True))
    except Exception:
        logger.exception("Retention check failed; will retry on the next interval")


async def worker(path, mode, stop, *, interval=INTERVAL_SECONDS):
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            await run_logged(path, mode)
