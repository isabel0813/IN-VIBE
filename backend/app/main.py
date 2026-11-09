"""바꿔도 돼? 백엔드 API."""
from __future__ import annotations

import os
from datetime import datetime
from typing import Iterator

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import db, planner
from .schemas import SettingsIn, SwitchIn, TaskCreate, TaskUpdate, UnitDone, WastedIn

app = FastAPI(title="바꿔도 돼? API", version="0.1.0")

origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_conn() -> Iterator:
    conn = db.connect()
    try:
        yield conn
    finally:
        conn.close()


def get_user(x_user_id: str = Header(..., min_length=1, max_length=64)) -> str:
    """로그인 대신 브라우저마다 만든 임의 ID를 X-User-Id 헤더로 받는다."""
    return x_user_id


def resolve_now(now: datetime | None) -> datetime:
    return db.to_kst(now) if now else db.now_kst()


@app.get("/health")
def health():
    return {"ok": True}


# ---------- 설정 ----------

@app.get("/settings")
def read_settings(user: str = Depends(get_user), conn=Depends(get_conn)):
    return {"daily_minutes": db.get_daily_minutes(conn, user)}


@app.put("/settings")
def write_settings(body: SettingsIn, user: str = Depends(get_user), conn=Depends(get_conn)):
    return {"daily_minutes": db.set_daily_minutes(conn, user, body.daily_minutes)}


# ---------- 일 ----------

@app.post("/tasks", status_code=201)
def create_task(body: TaskCreate, user: str = Depends(get_user), conn=Depends(get_conn)):
    task = db.create_task(conn, user, body.name, body.deadline, body.important,
                          [u.model_dump() for u in body.units])
    db.log_event(conn, user, "task_created", task["id"])
    return task


@app.get("/tasks")
def list_tasks(user: str = Depends(get_user), conn=Depends(get_conn)):
    return db.list_tasks(conn, user)


@app.get("/tasks/{task_id}")
def get_task(task_id: int, user: str = Depends(get_user), conn=Depends(get_conn)):
    task = db.get_task(conn, user, task_id)
    if not task:
        raise HTTPException(404, "일을 찾을 수 없어요")
    return task


@app.patch("/tasks/{task_id}")
def update_task(task_id: int, body: TaskUpdate, user: str = Depends(get_user),
                conn=Depends(get_conn)):
    units = [u.model_dump() for u in body.units] if body.units is not None else None
    task = db.update_task(conn, user, task_id, body.name, body.deadline, body.important, units)
    if not task:
        raise HTTPException(404, "일을 찾을 수 없어요")
    return task


@app.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: int, user: str = Depends(get_user), conn=Depends(get_conn)):
    if not db.delete_task(conn, user, task_id):
        raise HTTPException(404, "일을 찾을 수 없어요")


@app.patch("/units/{unit_id}")
def mark_unit(unit_id: int, body: UnitDone, user: str = Depends(get_user),
              conn=Depends(get_conn)):
    if not db.set_units_done(conn, user, [unit_id], body.done):
        raise HTTPException(404, "단위를 찾을 수 없어요")
    return {"id": unit_id, "done": body.done}


# ---------- 계획 ----------

@app.get("/plan")
def get_plan(now: datetime | None = Query(None, description="시연용 현재 시각"),
             user: str = Depends(get_user), conn=Depends(get_conn)):
    return planner.build_plan(db.planner_tasks(conn, user), resolve_now(now),
                              db.get_daily_minutes(conn, user))


@app.post("/plan/wasted")
def wasted(body: WastedIn, user: str = Depends(get_user), conn=Depends(get_conn)):
    """'시간 날렸어': 끝낸 단위를 반영하고, 날린 시간 때문에 새로 못 하게 된 일을 알려준다."""
    if body.done_unit_ids:
        db.set_units_done(conn, user, body.done_unit_ids, True)
    db.log_event(conn, user, "wasted", None, {"minutes": body.wasted_minutes})
    return planner.wasted_preview(db.planner_tasks(conn, user), resolve_now(body.now),
                                  body.wasted_minutes, db.get_daily_minutes(conn, user))


@app.post("/plan/switch")
def switch(body: SwitchIn, user: str = Depends(get_user), conn=Depends(get_conn)):
    """'다른 거 할래': minutes 동안 바꿔도 되는지, 넘기면 뭘 못 하게 되는지 미리 계산한다."""
    if body.target_task_id is not None and not db.get_task(conn, user, body.target_task_id):
        raise HTTPException(404, "옮겨 갈 일을 찾을 수 없어요")
    db.log_event(conn, user, "switch", body.target_task_id, {"minutes": body.minutes})
    return planner.switch_preview(db.planner_tasks(conn, user), resolve_now(body.now),
                                  body.minutes, body.target_task_id,
                                  db.get_daily_minutes(conn, user))
