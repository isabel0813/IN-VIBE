"""바꿔도 돼? 백엔드 API."""
from __future__ import annotations

import os
from datetime import datetime
from typing import Iterator

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import db, nlp, planner
from .schemas import ParseIn, SettingsIn, TaskBatchCreate, TaskCreate, TaskUpdate, WastedIn

app = FastAPI(title="바꿔도 돼? API", version="0.2.0")

origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])


def get_conn() -> Iterator:
    conn = db.connect()
    try:
        yield conn
    finally:
        conn.close()


def get_user(x_user_id: str = Header(..., min_length=1, max_length=64)) -> str:
    """로그인 대신 기기마다 만든 임의 ID를 X-User-Id 헤더로 받는다."""
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

@app.post("/tasks/parse")
def parse_tasks(body: ParseIn, user: str = Depends(get_user)):
    """자연어 목록 → 할 일 초안. 저장하지 않는다. 확인한 drafts를 POST /tasks/batch로 보낸다."""
    try:
        return nlp.parse_tasks_text(body.text, resolve_now(body.now))
    except nlp.NotConfigured as e:
        raise HTTPException(503, str(e))
    except nlp.ParseError as e:
        raise HTTPException(422, str(e))


@app.post("/tasks/batch", status_code=201)
def create_tasks(body: TaskBatchCreate, user: str = Depends(get_user), conn=Depends(get_conn)):
    created = [db.create_task(conn, user, t.name, t.deadline, t.important, t.estimated_minutes,
                              commit=False) for t in body.tasks]
    conn.commit()
    return created


@app.post("/tasks", status_code=201)
def create_task(body: TaskCreate, user: str = Depends(get_user), conn=Depends(get_conn)):
    return db.create_task(conn, user, body.name, body.deadline, body.important, body.estimated_minutes)


@app.get("/tasks")
def list_tasks(include_done: bool = True, user: str = Depends(get_user), conn=Depends(get_conn)):
    return db.list_tasks(conn, user, include_done)


@app.get("/tasks/{task_id}")
def get_task(task_id: int, user: str = Depends(get_user), conn=Depends(get_conn)):
    task = db.get_task(conn, user, task_id)
    if not task:
        raise HTTPException(404, "일을 찾을 수 없어요")
    return task


@app.patch("/tasks/{task_id}")
def update_task(task_id: int, body: TaskUpdate, user: str = Depends(get_user), conn=Depends(get_conn)):
    task = db.update_task(conn, user, task_id, body.name, body.deadline, body.important,
                          body.estimated_minutes, body.done)
    if not task:
        raise HTTPException(404, "일을 찾을 수 없어요")
    return task


@app.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: int, user: str = Depends(get_user), conn=Depends(get_conn)):
    if not db.delete_task(conn, user, task_id):
        raise HTTPException(404, "일을 찾을 수 없어요")


# ---------- 계획 ----------

@app.get("/plan")
def get_plan(now: datetime | None = Query(None, description="시연용 현재 시각"),
             user: str = Depends(get_user), conn=Depends(get_conn)):
    return planner.build_plan(db.planner_tasks(conn, user), resolve_now(now),
                              db.get_daily_minutes(conn, user))


@app.post("/plan/wasted")
def wasted(body: WastedIn, user: str = Depends(get_user), conn=Depends(get_conn)):
    """고해성사: 끝낸 일을 반영하고, 딴짓 때문에 시간이 모자라게 된 일을 알려준다."""
    if body.done_task_ids:
        db.set_done(conn, user, body.done_task_ids)
    db.log_event(conn, user, "wasted", None, {"minutes": body.wasted_minutes})
    return planner.wasted_preview(db.planner_tasks(conn, user), resolve_now(body.now),
                                  body.wasted_minutes, db.get_daily_minutes(conn, user))
