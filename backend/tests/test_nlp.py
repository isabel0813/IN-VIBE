from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from app import nlp
from app.schemas import TaskCreate

KST = ZoneInfo("Asia/Seoul")
NOW = datetime(2026, 11, 10, 20, 0, tzinfo=KST)  # 화요일

GOOD = """```json
{"name": "물리 과제", "deadline": "2026-11-11T23:59:00+09:00", "important": true,
 "units": [{"name": "1번", "minutes": 20, "required": true},
           {"name": "2번", "minutes": 20, "required": false}],
 "assumptions": ["문제당 20분으로 추정"]}
```"""


def fake(reply, seen=None):
    def _call(system, user_message):
        if seen is not None:
            seen.append(user_message)
        return reply
    return _call


def test_parses_draft_usable_for_create(monkeypatch):
    seen = []
    monkeypatch.setattr(nlp, "call_llm", fake(GOOD, seen))
    r = nlp.parse_task_text("물리 과제 내일까지 2문제 중요", NOW)
    TaskCreate(**r["draft"])  # 그대로 POST /tasks 본문이 된다
    assert r["draft"]["name"] == "물리 과제"
    assert r["assumptions"] == ["문제당 20분으로 추정"]
    assert "화요일" in seen[0] and "2026-11-10 20:00" in seen[0]


def test_past_deadline_is_flagged(monkeypatch):
    monkeypatch.setattr(nlp, "call_llm", fake(GOOD.replace("2026-11-11", "2026-11-09")))
    r = nlp.parse_task_text("물리 과제", NOW)
    assert any("지난" in a for a in r["assumptions"])


def test_bad_json_raises(monkeypatch):
    monkeypatch.setattr(nlp, "call_llm", fake("모르겠어요"))
    with pytest.raises(nlp.ParseError):
        nlp.parse_task_text("??", NOW)


def test_invalid_task_raises(monkeypatch):
    monkeypatch.setattr(nlp, "call_llm", fake('{"name": "x", "deadline": "2026-11-11T23:59:00", "units": []}'))
    with pytest.raises(nlp.ParseError):
        nlp.parse_task_text("x", NOW)


def test_missing_key_is_not_configured(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(nlp.NotConfigured):
        nlp.call_llm("s", "u")
