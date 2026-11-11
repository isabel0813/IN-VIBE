from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app import db, metrics

KST = ZoneInfo("Asia/Seoul")
T0 = datetime(2026, 11, 12, 19, 0, tzinfo=KST)


def ev(user, type_, minutes, task_id=None, payload=None):
    return {"user_id": user, "type": type_, "task_id": task_id, "payload": payload or {},
            "created_at": T0 + timedelta(minutes=minutes)}


def sample():
    events = [
        # A: 끝까지 수행, 고해성사 후 바로 복귀, 다음 날 재방문
        ev("A", "app_open", 0), ev("A", "tasks_saved", 2), ev("A", "plan_viewed", 3),
        ev("A", "focus_started", 4, 1), ev("A", "wasted", 30, payload={"minutes": 20}),
        ev("A", "focus_resumed", 35), ev("A", "task_done", 90, 1),
        ev("A", "app_open", 60 * 24),
        # B: 작업 시작 후 그만둠
        ev("B", "app_open", 0), ev("B", "tasks_saved", 5), ev("B", "plan_viewed", 6),
        ev("B", "focus_started", 7, 2), ev("B", "focus_ended", 20, 2),
        ev("B", "wasted", 25),
        # C: 저장 전에 이탈
        ev("C", "app_open", 0), ev("C", "parse_requested", 1), ev("C", "parse_failed", 2),
        ev("C", "manual_input_used", 3),
        # D: 말풍선 응답
        ev("D", "app_open", 0), ev("D", "checkin_shown", 10),
        ev("D", "checkin_answered", 11, payload={"answer": "studying"}),
    ]
    tasks = [
        {"id": 1, "user_id": "A", "deadline": T0 + timedelta(hours=3), "created_at": T0,
         "done_at": T0 + timedelta(minutes=90)},
        {"id": 2, "user_id": "B", "deadline": T0 + timedelta(hours=1), "created_at": T0,
         "done_at": None},
        {"id": 3, "user_id": "B", "deadline": T0 + timedelta(days=5), "created_at": T0,
         "done_at": None},
    ]
    return events, tasks


def test_funnel_and_drop_off():
    events, tasks = sample()
    m = metrics.compute(events, tasks, T0 + timedelta(days=2))
    assert [s["users"] for s in m["funnel"]] == [4, 2, 2, 2, 1]
    saved = m["funnel"][1]
    assert saved["drop_off_from_previous"] == {"numerator": 2, "denominator": 4, "rate": 0.5}
    assert m["core_completion"] == {"numerator": 1, "denominator": 4, "rate": 0.25}


def test_task_and_session_outcomes():
    events, tasks = sample()
    m = metrics.compute(events, tasks, T0 + timedelta(days=2))
    # 마감이 지났거나 끝난 일만 분모: 1번(완료), 2번(마감 지남) → 1/2
    assert m["tasks"]["done_on_time"] == {"numerator": 1, "denominator": 2, "rate": 0.5}
    assert m["tasks"]["missed"] == 1
    assert m["focus_sessions"]["started"] == 2
    assert m["focus_sessions"]["completed"]["numerator"] == 1
    assert m["focus_sessions"]["abandoned"]["numerator"] == 1


def test_recovery_checkin_returning_parse():
    events, tasks = sample()
    m = metrics.compute(events, tasks, T0 + timedelta(days=2))
    assert m["recovery_after_confession"] == {"numerator": 1, "denominator": 2, "rate": 0.5}
    assert m["checkin"]["answers"] == {"studying": 1}
    assert m["checkin"]["response_rate"]["rate"] == 1.0
    assert m["returning_users"] == {"numerator": 1, "denominator": 4, "rate": 0.25}
    assert m["parse"]["success"] == {"numerator": 0, "denominator": 1, "rate": 0.0}
    assert m["parse"]["manual_input_used"] == 1


def test_empty():
    m = metrics.compute([], [], T0)
    assert m["users"] == 0
    assert m["core_completion"]["rate"] is None


def test_anon_is_stable_and_short():
    assert metrics.anon("abc") == metrics.anon("abc")
    assert len(metrics.anon("abc")) == 10 and metrics.anon("abc") != "abc"


@pytest.fixture
def conn(tmp_path):
    c = db.connect(str(tmp_path / "m.db"))
    yield c
    c.close()


def test_db_roundtrip(conn):
    t = db.create_task(conn, "u1", "물리", datetime(2026, 11, 12, 22, 0), False, 60)
    db.log_event(conn, "u1", "app_open")
    db.log_event(conn, "u1", "focus_started", t["id"], {"from": "widget"})
    db.update_task(conn, "u1", t["id"], done=True)
    events = db.all_events(conn)
    assert [e["type"] for e in events] == ["app_open", "focus_started", "task_done"]
    assert events[1]["payload"] == {"from": "widget"}
    tasks = db.all_tasks(conn)
    assert tasks[0]["done_at"] is not None and tasks[0]["deadline"].tzinfo is not None
    m = metrics.compute(events, tasks, db.now_kst())
    assert m["focus_sessions"]["completed"]["numerator"] == 1
