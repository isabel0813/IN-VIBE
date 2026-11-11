"""사용자 검증 지표 계산.

events 테이블에 쌓인 기록과 tasks 테이블을 받아 숫자로 바꾼다.
DB나 FastAPI에 의존하지 않으므로 단독으로 테스트할 수 있다.
모든 비율은 분자·분모를 함께 돌려준다.
"""
from __future__ import annotations

import hashlib
from collections import defaultdict
from datetime import datetime, timedelta

# 프론트가 POST /events 로 보낼 수 있는 이벤트
CLIENT_EVENTS = {
    "app_open",          # 앱(웹) 접속
    "plan_viewed",       # 계획 화면을 사용자가 열어 봄 (1분 자동 갱신은 보내지 않음)
    "focus_started",     # 작업 시작 (task_id 포함)
    "focus_paused",
    "focus_resumed",
    "focus_ended",       # 완료하지 않고 세션 종료 (task_id 포함)
    "checkin_shown",     # "딴짓하세요?" 말풍선 표시
    "checkin_answered",  # 말풍선 응답 (payload.answer: confess | studying | rest | later)
    "manual_input_used", # AI 대신 직접 입력 폼 사용
    "feedback_opened",   # 피드백 링크 클릭
}
# 서버가 자동으로 남기는 이벤트
SERVER_EVENTS = {
    "parse_requested", "parse_succeeded", "parse_failed",
    "tasks_saved", "task_done", "task_undone", "wasted",
}

FUNNEL = [
    ("visited", "접속", {"app_open"}),
    ("saved", "할 일 저장", {"tasks_saved"}),
    ("viewed_plan", "계획 확인", {"plan_viewed"}),
    ("started", "작업 시작", {"focus_started"}),
    ("completed", "작업 완료", {"task_done"}),
]

RECOVERY_WINDOW = timedelta(minutes=30)
SESSION_WINDOW = timedelta(hours=6)


def _ratio(num: int, den: int) -> dict:
    return {"numerator": num, "denominator": den,
            "rate": round(num / den, 3) if den else None}


def anon(user_id: str) -> str:
    """제출 자료용 익명 ID."""
    return hashlib.sha256(user_id.encode("utf-8")).hexdigest()[:10]


def compute(events: list[dict], tasks: list[dict], now: datetime) -> dict:
    """events: {user_id, type, task_id, payload(dict), created_at(datetime)}
    tasks: {id, user_id, deadline(datetime), created_at(datetime), done_at(datetime|None)}
    """
    events = sorted(events, key=lambda e: e["created_at"])
    by_user: dict[str, list[dict]] = defaultdict(list)
    for e in events:
        by_user[e["user_id"]].append(e)
    users = set(by_user)

    # 1. 단계별 퍼널과 이탈률 (단계마다 그 이벤트를 한 번이라도 남긴 사용자 수)
    funnel = []
    prev = None
    for key, label, types in FUNNEL:
        reached = {u for u, evs in by_user.items() if any(e["type"] in types for e in evs)}
        step = {"step": key, "label": label, "users": len(reached)}
        if prev is not None:
            kept = len(reached & prev)
            step["conversion_from_previous"] = _ratio(kept, len(prev))
            step["drop_off_from_previous"] = _ratio(len(prev) - kept, len(prev))
        funnel.append(step)
        prev = reached

    # 2. 마감 안에 끝낸 비율 (마감이 지났거나 이미 끝난 일만 분모)
    judged = [t for t in tasks if t["done_at"] is not None or t["deadline"] <= now]
    on_time = [t for t in judged if t["done_at"] is not None and t["done_at"] <= t["deadline"]]
    done_late = [t for t in judged if t["done_at"] is not None and t["done_at"] > t["deadline"]]
    missed = [t for t in judged if t["done_at"] is None]

    # 3. 작업 세션: 시작한 작업을 끝까지 완료했는지, 중간에 그만뒀는지
    sessions = completed_sessions = abandoned_sessions = 0
    for u, evs in by_user.items():
        for i, e in enumerate(evs):
            if e["type"] != "focus_started":
                continue
            sessions += 1
            outcome = None
            for nxt in evs[i + 1:]:
                if nxt["created_at"] - e["created_at"] > SESSION_WINDOW:
                    break
                if nxt["type"] == "focus_started":
                    break
                if nxt["type"] == "task_done" and nxt.get("task_id") == e.get("task_id"):
                    outcome = "completed"
                    break
                if nxt["type"] == "focus_ended":
                    outcome = "abandoned"
                    break
            if outcome == "completed":
                completed_sessions += 1
            elif outcome == "abandoned":
                abandoned_sessions += 1

    # 4. 고해성사 후 30분 안에 다시 시작하거나 완료했는지
    wasted = recovered = 0
    for u, evs in by_user.items():
        for i, e in enumerate(evs):
            if e["type"] != "wasted":
                continue
            wasted += 1
            if any(n["type"] in {"focus_started", "focus_resumed", "task_done"}
                   and n["created_at"] - e["created_at"] <= RECOVERY_WINDOW
                   for n in evs[i + 1:]):
                recovered += 1

    # 5. 말풍선 응답
    shown = sum(1 for e in events if e["type"] == "checkin_shown")
    answers = defaultdict(int)
    for e in events:
        if e["type"] == "checkin_answered":
            answers[str((e.get("payload") or {}).get("answer", "unknown"))] += 1

    # 6. 재방문: 서로 다른 날(한국 시간) 2일 이상 활동한 사용자
    days = {u: {e["created_at"].date() for e in evs} for u, evs in by_user.items()}
    returning = sum(1 for d in days.values() if len(d) >= 2)

    # 7. 자연어 등록 성공률
    parse_req = sum(1 for e in events if e["type"] == "parse_requested")
    parse_ok = sum(1 for e in events if e["type"] == "parse_succeeded")
    manual = sum(1 for e in events if e["type"] == "manual_input_used")

    first = events[0]["created_at"].isoformat() if events else None
    last = events[-1]["created_at"].isoformat() if events else None

    return {
        "generated_at": now.isoformat(),
        "period": {"first_event": first, "last_event": last},
        "users": len(users),
        "funnel": funnel,
        "core_completion": _ratio(funnel[-1]["users"], funnel[0]["users"] or len(users)),
        "tasks": {
            "created": len(tasks),
            "judged": len(judged),
            "done_on_time": _ratio(len(on_time), len(judged)),
            "done_late": len(done_late),
            "missed": len(missed),
        },
        "focus_sessions": {
            "started": sessions,
            "completed": _ratio(completed_sessions, sessions),
            "abandoned": _ratio(abandoned_sessions, sessions),
            "unknown": sessions - completed_sessions - abandoned_sessions,
        },
        "recovery_after_confession": _ratio(recovered, wasted),
        "checkin": {"shown": shown, "answers": dict(answers),
                    "response_rate": _ratio(sum(answers.values()), shown)},
        "returning_users": _ratio(returning, len(users)),
        "parse": {"success": _ratio(parse_ok, parse_req), "manual_input_used": manual},
    }
