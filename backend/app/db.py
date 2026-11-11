"""SQLite 저장소. 표준 라이브러리 sqlite3만 사용한다."""
from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime
from zoneinfo import ZoneInfo

from . import planner

KST = ZoneInfo("Asia/Seoul")
DB_PATH = os.getenv("DB_PATH", "bakkwodo.db")
DEFAULT_DAILY_MINUTES = 480

SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    deadline TEXT NOT NULL,
    important INTEGER NOT NULL DEFAULT 0,
    estimated_minutes INTEGER NOT NULL DEFAULT 60,
    done_at TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    task_id INTEGER,
    payload TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    user_id TEXT PRIMARY KEY,
    daily_minutes INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
"""


def connect(path: str | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def to_kst(dt: datetime) -> datetime:
    """시간대가 없는 값은 한국 시간으로 본다."""
    return dt.replace(tzinfo=KST) if dt.tzinfo is None else dt.astimezone(KST)


def now_kst() -> datetime:
    return datetime.now(KST)


def _row(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "deadline": row["deadline"],
        "important": bool(row["important"]),
        "estimated_minutes": row["estimated_minutes"],
        "done": row["done_at"] is not None,
        "done_at": row["done_at"],
    }


def create_task(conn, user_id: str, name: str, deadline: datetime, important: bool = False,
                estimated_minutes: int = 60, commit: bool = True) -> dict:
    cur = conn.execute(
        "INSERT INTO tasks (user_id, name, deadline, important, estimated_minutes, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, name, to_kst(deadline).isoformat(), int(important), int(estimated_minutes),
         now_kst().isoformat()),
    )
    if commit:
        conn.commit()
    return get_task(conn, user_id, cur.lastrowid)


def get_task(conn, user_id: str, task_id: int) -> dict | None:
    row = conn.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id)).fetchone()
    return _row(row) if row else None


def list_tasks(conn, user_id: str, include_done: bool = True) -> list[dict]:
    sql = "SELECT * FROM tasks WHERE user_id = ?"
    if not include_done:
        sql += " AND done_at IS NULL"
    rows = conn.execute(sql + " ORDER BY deadline, id", (user_id,)).fetchall()
    return [_row(r) for r in rows]


def update_task(conn, user_id: str, task_id: int, name=None, deadline=None, important=None,
                estimated_minutes=None, done=None) -> dict | None:
    if not get_task(conn, user_id, task_id):
        return None
    fields = {
        "name": name,
        "deadline": to_kst(deadline).isoformat() if deadline is not None else None,
        "important": int(important) if important is not None else None,
        "estimated_minutes": estimated_minutes,
    }
    for col, value in fields.items():
        if value is not None:
            conn.execute(f"UPDATE tasks SET {col} = ? WHERE id = ?", (value, task_id))
    if done is not None:
        conn.execute("UPDATE tasks SET done_at = ? WHERE id = ?",
                     (now_kst().isoformat() if done else None, task_id))
        log_event(conn, user_id, "task_done" if done else "task_undone", task_id, commit=False)
    conn.commit()
    return get_task(conn, user_id, task_id)


def set_done(conn, user_id: str, task_ids: list[int]) -> list[int]:
    changed = []
    for tid in task_ids:
        if update_task(conn, user_id, tid, done=True):
            changed.append(tid)
    return changed


def delete_task(conn, user_id: str, task_id: int) -> bool:
    cur = conn.execute("DELETE FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id))
    conn.commit()
    return cur.rowcount > 0


def get_daily_minutes(conn, user_id: str) -> int:
    row = conn.execute("SELECT daily_minutes FROM settings WHERE user_id = ?", (user_id,)).fetchone()
    return row["daily_minutes"] if row else DEFAULT_DAILY_MINUTES


def set_daily_minutes(conn, user_id: str, minutes: int) -> int:
    conn.execute(
        "INSERT INTO settings (user_id, daily_minutes) VALUES (?, ?) "
        "ON CONFLICT(user_id) DO UPDATE SET daily_minutes = excluded.daily_minutes",
        (user_id, minutes),
    )
    conn.commit()
    return minutes


def log_event(conn, user_id: str, type_: str, task_id: int | None = None,
              payload: dict | None = None, commit: bool = True) -> None:
    conn.execute(
        "INSERT INTO events (user_id, type, task_id, payload, created_at) VALUES (?, ?, ?, ?, ?)",
        (user_id, type_, task_id, json.dumps(payload or {}, ensure_ascii=False), now_kst().isoformat()),
    )
    if commit:
        conn.commit()


def all_events(conn, since: datetime | None = None, until: datetime | None = None) -> list[dict]:
    """지표 계산용: 모든 사용자의 이벤트."""
    sql, args = "SELECT * FROM events WHERE 1=1", []
    if since is not None:
        sql += " AND created_at >= ?"
        args.append(to_kst(since).isoformat())
    if until is not None:
        sql += " AND created_at < ?"
        args.append(to_kst(until).isoformat())
    rows = conn.execute(sql + " ORDER BY created_at, id", args).fetchall()
    return [
        {
            "user_id": r["user_id"],
            "type": r["type"],
            "task_id": r["task_id"],
            "payload": json.loads(r["payload"] or "{}"),
            "created_at": to_kst(datetime.fromisoformat(r["created_at"])),
        }
        for r in rows
    ]


def all_tasks(conn, since: datetime | None = None, until: datetime | None = None) -> list[dict]:
    """지표 계산용: 모든 사용자의 일 (생성 시각 기준으로 거른다)."""
    sql, args = "SELECT * FROM tasks WHERE 1=1", []
    if since is not None:
        sql += " AND created_at >= ?"
        args.append(to_kst(since).isoformat())
    if until is not None:
        sql += " AND created_at < ?"
        args.append(to_kst(until).isoformat())
    rows = conn.execute(sql, args).fetchall()
    parse = lambda v: to_kst(datetime.fromisoformat(v)) if v else None  # noqa: E731
    return [
        {
            "id": r["id"],
            "user_id": r["user_id"],
            "deadline": parse(r["deadline"]),
            "created_at": parse(r["created_at"]),
            "done_at": parse(r["done_at"]),
        }
        for r in rows
    ]


def planner_tasks(conn, user_id: str) -> list[planner.Task]:
    """완료하지 않은 일만 계산 로직에 넘긴다."""
    return [
        planner.Task(id=t["id"], name=t["name"],
                     deadline=to_kst(datetime.fromisoformat(t["deadline"])),
                     important=t["important"], estimated_minutes=t["estimated_minutes"])
        for t in list_tasks(conn, user_id, include_done=False)
    ]
