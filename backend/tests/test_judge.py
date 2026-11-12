from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app import db, judge, metrics, nlp

KST = ZoneInfo("Asia/Seoul")
T0 = datetime(2026, 11, 13, 20, 0, tzinfo=KST)


def fake_llm(reply):
    calls = []

    def _call(system, user_message):
        calls.append(user_message)
        return reply
    return _call, calls


def test_judge_title_categories(monkeypatch):
    # 공부·확실한 배경음악은 냅두고, 나머지(애매함 + 딴짓)는 전부 "너 혹시 딴짓해?"
    for category, action in [("study", "ignore"), ("background", "ignore"), ("other", "ask")]:
        call, calls = fake_llm(f'{{"category": "{category}", "reason": "이유"}}')
        monkeypatch.setattr(nlp, "call_llm", call)
        r = judge.judge_title("전자기 유도 공부", "패러데이 법칙 10분 정리")
        assert r == {"category": category, "action": action, "reason": "이유"}
        assert "할 일: 전자기 유도 공부" in calls[0] and "패러데이" in calls[0]
    assert judge.action_for("user_ok") == "ignore"


def test_judge_title_bad_category(monkeypatch):
    call, _ = fake_llm('{"category": "maybe"}')
    monkeypatch.setattr(nlp, "call_llm", call)
    with pytest.raises(nlp.ParseError):
        judge.judge_title("물리", "아무 영상")


def test_video_key_hides_title_and_prefers_id():
    k = judge.video_key("dQw4w9WgXcQ", "제목")
    assert k == judge.video_key("dQw4w9WgXcQ", "다른 제목")
    assert "제목" not in judge.video_key(None, "제목") and len(k) == 24


@pytest.fixture
def conn(tmp_path):
    c = db.connect(str(tmp_path / "j.db"))
    yield c
    c.close()


def test_session_and_judgment_roundtrip(conn):
    s1 = db.start_session(conn, "u1", "전자기 유도 공부")
    s2 = db.start_session(conn, "u1", "논리회로 과제")
    assert db.get_session(conn, "u1", s1["id"])["end_reason"] == "replaced"
    assert db.current_session(conn, "u1")["id"] == s2["id"]
    assert db.get_session(conn, "other", s2["id"]) is None

    key = judge.video_key("abcdefghijk", "게임 영상")
    db.save_judgment(conn, s2["id"], key, "other", "ai", "게임", count_ai_call=True)
    assert db.get_judgment(conn, s2["id"], key) == {"category": "other", "reason": "게임", "source": "ai"}
    db.save_judgment(conn, s2["id"], key, "user_ok", "user", "사용자가 정정함")
    assert db.get_judgment(conn, s2["id"], key)["category"] == "user_ok"
    assert db.session_ai_calls(conn, s2["id"]) == 1
    # 제목 원문은 DB 어디에도 저장되지 않는다
    dump = "\n".join(conn.iterdump())
    assert "게임 영상" not in dump

    db.end_session(conn, "u1", s2["id"], "completed")
    assert db.current_session(conn, "u1") is None
    types = [e["type"] for e in db.all_events(conn)]
    assert types.count("session_started") == 2 and types.count("session_ended") == 2


def ev(user, type_, minutes, payload=None):
    return {"user_id": user, "type": type_, "task_id": None, "payload": payload or {},
            "created_at": T0 + timedelta(minutes=minutes)}


def test_focus_metrics():
    events = [
        # A: 개입 → 예 → 2분 뒤 복귀
        ev("A", "app_open", 0), ev("A", "session_started", 1),
        ev("A", "intervention_shown", 10, {"stage": "bubble", "variant": "shake"}),
        ev("A", "intervention_answered", 10.2, {"answer": "yes"}),
        ev("A", "returned", 12, {"seconds": 120}),
        # B: 오탐 정정, 이후 개입 무시하고 복귀 안 함
        ev("B", "app_open", 0), ev("B", "session_started", 1),
        ev("B", "intervention_shown", 5, {"variant": "shake"}),
        ev("B", "intervention_answered", 5.1, {"answer": "not_distracted"}),
        ev("B", "judge_corrected", 5.1),
        ev("B", "intervention_shown", 30, {"variant": "stare"}),
        ev("B", "intervention_answered", 31, {"answer": "none"}),
        ev("B", "returned", 50, {"seconds": 1200}),  # 10분 넘어서 복귀 → 실패로 셈
        ev("B", "widget_hidden", 60, {"duration": "30m"}),
        # C: 접속만
        ev("C", "app_open", 0),
        ev("A", "judge_requested", 9, {"source": "ai"}), ev("A", "judge_requested", 11, {"source": "cache"}),
    ]
    f = metrics.compute(events, [], T0 + timedelta(days=1))["focus"]
    assert [s["users"] for s in f["funnel"]] == [3, 2, 2, 2]
    assert f["interventions"] == 3
    assert f["return_after_intervention"] == {"numerator": 1, "denominator": 3, "rate": 0.333}
    assert f["median_return_seconds"] == 120
    assert f["false_positive"] == {"numerator": 1, "denominator": 2, "rate": 0.5}
    assert f["ignored"]["numerator"] == 1
    assert f["by_variant"]["shake"] == {"shown": 2, "returned": 1, "return_rate": 0.5}
    assert f["hidden"] == {"30m": 1}
    assert f["judge"] == {"ai_calls": 1, "cache_hits": 1, "corrections": 1}
