"""SQLite 저장소. 표준 라이브러리 sqlite3만 사용한다."""
from __future__ import annotations

import json
import math
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
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    minutes INTEGER NOT NULL,
    required INTEGER NOT NULL DEFAULT 0,
    ord INTEGER NOT NULL DEFAULT 0,
    done_at TEXT
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
CREATE INDEX IF NOT EXISTS idx_units_task ON units(task_id);
"""


def connect(path: str | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    return conn


def to_kst(dt: datetime) -> datetime:
    """시간대가 없는 값은 한국 시간으로 본다."""
    return dt.replace(tzinfo=KST) if dt.tzinfo is None else dt.astimezone(KST)


def now_kst() -> datetime:
    return datetime.now(KST)


# ---------- 일과 단위 ----------

def _insert_units(conn, task_id: int, units: list[dict]) -> None:
    # 필수 단위를 하나도 고르지 않으면 앞에서부터 절반(올림)을 필수로 둔다.
    if units and not any(u.get("required") for u in units):
        n = math.ceil(len(units) / 2)
        units = [{**u, "required": i < n} for i, u in enumerate(units)]
    for i, u in enumerate(units):
        conn.execute(
            "INSERT INTO units (task_id, name, minutes, required, ord) VALUES (?, ?, ?, ?, ?)",
            (task_id, u["name"], int(u["minutes"]), int(bool(u.get("required"))), i),
        )


def _task_row_to_dict(conn, row) -> dict:
    units = conn.execute(
        "SELECT * FROM units WHERE task_id = ? ORDER BY ord", (row["id"],)
    ).fetchall()
    return {
        "id": row["id"],
        "name": row["name"],
        "deadline": row["deadline"],
        "important": bool(row["important"]),
        "units": [
            {
                "id": u["id"],
                "name": u["name"],
                "minutes": u["minutes"],
                "required": bool(u["required"]),
                "order": u["ord"],
                "done": u["done_at"] is not None,
                "done_at": u["done_at"],
            }
            for u in units
        ],
    }


def create_task(conn, user_id: str, name: str, deadline: datetime, important: bool,
                units: list[dict]) -> dict:
    cur = conn.execute(
        "INSERT INTO tasks (user_id, name, deadline, important, created_at) VALUES (?, ?, ?, ?, ?)",
        (user_id, name, to_kst(deadline).isoformat(), int(important), now_kst().isoformat()),
    )
    task_id = cur.lastrowid
    _insert_units(conn, task_id, units)
    conn.commit()
    return get_task(conn, user_id, task_id)


def get_task(conn, user_id: str, task_id: int) -> dict | None:
    row = conn.execute(
        "SELECT * FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id)
    ).fetchone()
    return _task_row_to_dict(conn, row) if row else None


def list_tasks(conn, user_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM tasks WHERE user_id = ? ORDER BY deadline, id", (user_id,)
    ).fetchall()
    return [_task_row_to_dict(conn, r) for r in rows]


def update_task(conn, user_id: str, task_id: int, name=None, deadline=None,
                important=None, units=None) -> dict | None:
    if not get_task(conn, user_id, task_id):
        return None
    if name is not None:
        conn.execute("UPDATE tasks SET name = ? WHERE id = ?", (name, task_id))
    if deadline is not None:
        conn.execute("UPDATE tasks SET deadline = ? WHERE id = ?",
                     (to_kst(deadline).isoformat(), task_id))
    if important is not None:
        conn.execute("UPDATE tasks SET important = ? WHERE id = ?", (int(important), task_id))
    if units is not None:  # 단위 목록을 통째로 교체
        conn.execute("DELETE FROM units WHERE task_id = ?", (task_id,))
        _insert_units(conn, task_id, units)
    conn.commit()
    return get_task(conn, user_id, task_id)


def delete_task(conn, user_id: str, task_id: int) -> bool:
    cur = conn.execute("DELETE FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id))
    conn.commit()
    return cur.rowcount > 0


def set_units_done(conn, user_id: str, unit_ids: list[int], done: bool = True) -> list[int]:
    """사용자 본인의 단위만 완료/취소 처리하고, 실제로 바뀐 id 목록을 돌려준다."""
    changed = []
    for unit_id in unit_ids:
        row = conn.execute(
            "SELECT units.id, units.task_id FROM units JOIN tasks ON tasks.id = units.task_id "
            "WHERE units.id = ? AND tasks.user_id = ?",
            (unit_id, user_id),
        ).fetchone()
        if not row:
            continue
        conn.execute("UPDATE units SET done_at = ? WHERE id = ?",
                     (now_kst().isoformat() if done else None, unit_id))
        log_event(conn, user_id, "unit_done" if done else "unit_undone", row["task_id"],
                  {"unit_id": unit_id}, commit=False)
        changed.append(unit_id)
    conn.commit()
    return changed


# ---------- 설정과 기록 ----------

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
        (user_id, type_, task_id, json.dumps(payload or {}, ensure_ascii=False),
         now_kst().isoformat()),
    )
    if commit:
        conn.commit()


# ---------- 계산용 변환 ----------

def planner_tasks(conn, user_id: str) -> list[planner.Task]:
    """완료하지 않은 단위만 담아 계산 로직에 넘긴다."""
    out = []
    for t in list_tasks(conn, user_id):
        units = [
            planner.Unit(id=u["id"], name=u["name"], minutes=u["minutes"],
                         required=u["required"], order=u["order"])
            for u in t["units"] if not u["done"]
        ]
        out.append(planner.Task(id=t["id"], name=t["name"],
                                deadline=to_kst(datetime.fromisoformat(t["deadline"])),
                                important=t["important"], units=units))
    return out
