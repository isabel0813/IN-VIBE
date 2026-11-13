"""뭐보뇽 백엔드 API."""
from __future__ import annotations

import csv
import hmac
import io
import json
import os
from datetime import datetime
from typing import Iterator

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

from . import db, judge, metrics, nlp, planner
from .schemas import (EventIn, JudgeFeedbackIn, JudgeIn, ParseIn, SessionEnd, SessionIn,
                      SettingsIn, TaskBatchCreate, TaskCreate, TaskUpdate, WastedIn)

app = FastAPI(title="뭐보뇽 API", version="0.4.0")

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


def require_metrics_token(x_metrics_token: str = Header("", alias="X-Metrics-Token")) -> None:
    """지표는 전체 사용자 데이터라 팀만 볼 수 있게 METRICS_TOKEN으로 막는다."""
    expected = os.getenv("METRICS_TOKEN", "")
    if not expected or not hmac.compare_digest(x_metrics_token, expected):
        raise HTTPException(403, "지표를 볼 권한이 없어요")


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
def parse_tasks(body: ParseIn, user: str = Depends(get_user), conn=Depends(get_conn)):
    """자연어 목록 → 할 일 초안. 저장하지 않는다. 확인한 drafts를 POST /tasks/batch로 보낸다."""
    db.log_event(conn, user, "parse_requested", None, {"chars": len(body.text)})
    try:
        result = nlp.parse_tasks_text(body.text, resolve_now(body.now))
    except nlp.NotConfigured as e:
        db.log_event(conn, user, "parse_failed", None, {"reason": "not_configured"})
        raise HTTPException(503, str(e))
    except nlp.ParseError as e:
        db.log_event(conn, user, "parse_failed", None, {"reason": "parse_error"})
        raise HTTPException(422, str(e))
    db.log_event(conn, user, "parse_succeeded", None, {"count": len(result["drafts"])})
    return result


@app.post("/tasks/batch", status_code=201)
def create_tasks(body: TaskBatchCreate, user: str = Depends(get_user), conn=Depends(get_conn)):
    created = [db.create_task(conn, user, t.name, t.deadline, t.important, t.estimated_minutes,
                              commit=False) for t in body.tasks]
    db.log_event(conn, user, "tasks_saved", None, {"count": len(created)}, commit=False)
    conn.commit()
    return created


@app.post("/tasks", status_code=201)
def create_task(body: TaskCreate, user: str = Depends(get_user), conn=Depends(get_conn)):
    task = db.create_task(conn, user, body.name, body.deadline, body.important, body.estimated_minutes)
    db.log_event(conn, user, "tasks_saved", task["id"], {"count": 1})
    return task


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


# ---------- 집중 세션과 영상 판단 ----------

def _active_session(conn, user: str, session_id: int) -> dict:
    s = db.get_session(conn, user, session_id)
    if not s:
        raise HTTPException(404, "세션을 찾을 수 없어요")
    if not s["active"]:
        raise HTTPException(409, "이미 끝난 세션이에요")
    return s


@app.post("/sessions", status_code=201)
def start_session(body: SessionIn, user: str = Depends(get_user), conn=Depends(get_conn)):
    """지금 할 일 한 줄로 집중 세션을 시작한다. 진행 중인 세션은 자동으로 끝낸다."""
    return db.start_session(conn, user, body.task.strip())


@app.get("/sessions/current")
def current_session(user: str = Depends(get_user), conn=Depends(get_conn)):
    """진행 중인 세션. 없으면 null."""
    return db.current_session(conn, user)


@app.post("/sessions/{session_id}/end")
def end_session(session_id: int, body: SessionEnd | None = None, user: str = Depends(get_user),
                conn=Depends(get_conn)):
    s = db.end_session(conn, user, session_id, (body or SessionEnd()).reason)
    if not s:
        raise HTTPException(404, "세션을 찾을 수 없어요")
    return s


@app.post("/judge")
def judge_video(body: JudgeIn, user: str = Depends(get_user), conn=Depends(get_conn)):
    """영상을 분류하고 개입할지 알려준다.
    action: ignore(공부·배경음악 → 냅둠) / ask("너 혹시 딴짓해?" 띄움).
    제목은 AI 판단에만 쓰고 저장하지 않는다. 같은 세션의 같은 영상은 저장된 결과를 돌려준다."""
    s = _active_session(conn, user, body.session_id)
    key = judge.video_key(body.video_id, body.title)
    cached = db.get_judgment(conn, s["id"], key)
    if cached:
        db.log_event(conn, user, "judge_requested", None,
                     {"session_id": s["id"], "source": "cache", "category": cached["category"]})
        return {**cached, "action": judge.action_for(cached["category"]), "cached": True}

    limit = int(os.getenv("JUDGE_MAX_PER_SESSION", "120"))
    if db.session_ai_calls(conn, s["id"]) >= limit:
        raise HTTPException(429, "이 세션에서 AI 판단 횟수를 다 썼어요")
    try:
        result = judge.judge_title(s["task"], body.title)
    except nlp.NotConfigured as e:
        raise HTTPException(503, str(e))
    except nlp.ParseError as e:
        db.log_event(conn, user, "judge_failed", None, {"session_id": s["id"]})
        raise HTTPException(502, str(e))
    db.save_judgment(conn, s["id"], key, result["category"], "ai", result["reason"],
                     count_ai_call=True)
    db.log_event(conn, user, "judge_requested", None,
                 {"session_id": s["id"], "source": "ai", "category": result["category"]})
    return {**result, "source": "ai", "cached": False}


@app.post("/judge/feedback")
def judge_feedback(body: JudgeFeedbackIn, user: str = Depends(get_user), conn=Depends(get_conn)):
    """"아니? 전혀~": 이 세션에서 이 영상은 냅두고 다시 묻지 않는다."""
    s = _active_session(conn, user, body.session_id)
    key = judge.video_key(body.video_id, body.title)
    before = db.get_judgment(conn, s["id"], key)
    db.save_judgment(conn, s["id"], key, "user_ok", "user", "사용자가 정정함")
    db.log_event(conn, user, "judge_corrected", None,
                 {"session_id": s["id"],
                  "previous": before["category"] if before else None,
                  "previous_source": before["source"] if before else None})
    return {"category": "user_ok", "action": "ignore", "reason": "사용자가 정정함",
            "source": "user", "cached": True}


# ---------- 사용자 검증 지표 ----------

@app.post("/events", status_code=204)
def record_event(body: EventIn, user: str = Depends(get_user), conn=Depends(get_conn)):
    """프론트에서만 알 수 있는 행동(접속, 계획 확인, 작업 시작 등)을 기록한다."""
    if body.type not in metrics.CLIENT_EVENTS:
        raise HTTPException(422, f"기록할 수 없는 이벤트예요: {body.type}")
    if len(json.dumps(body.payload, ensure_ascii=False)) > 500:
        raise HTTPException(422, "payload가 너무 커요")
    db.log_event(conn, user, body.type, body.task_id, body.payload)


@app.get("/metrics", dependencies=[Depends(require_metrics_token)])
def get_metrics(since: datetime | None = Query(None, description="이 시각 이후 (예: 2026-11-11T00:00:00)"),
                until: datetime | None = Query(None, description="이 시각 이전"),
                conn=Depends(get_conn)):
    """퍼널·이탈률·마감 내 완료율·세션 완료율·고해성사 후 복귀율·재방문을 계산한다."""
    return metrics.compute(db.all_events(conn, since, until), db.all_tasks(conn, since, until),
                           db.now_kst())


@app.get("/metrics/events.csv", dependencies=[Depends(require_metrics_token)],
         response_class=PlainTextResponse)
def export_events(since: datetime | None = Query(None), until: datetime | None = Query(None),
                  conn=Depends(get_conn)):
    """제출·분석용 원본 이벤트. 사용자 ID는 익명화한다."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["created_at", "user", "type", "task_id", "payload"])
    for e in db.all_events(conn, since, until):
        writer.writerow([e["created_at"].isoformat(), metrics.anon(e["user_id"]), e["type"],
                         e["task_id"] or "", json.dumps(e["payload"], ensure_ascii=False)])
    return PlainTextResponse(buf.getvalue(), media_type="text/csv; charset=utf-8")
