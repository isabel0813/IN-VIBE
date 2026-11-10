from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from app import nlp
from app.schemas import TaskBatchCreate

KST = ZoneInfo("Asia/Seoul")
NOW = datetime(2026, 11, 10, 17, 0, tzinfo=KST)  # 화요일

GOOD = """```json
{"tasks": [
  {"name": "물리 과제", "deadline": "2026-11-10T22:00:00+09:00", "important": false, "estimated_minutes": 120},
  {"name": "INVIBE 최종 시연", "deadline": "2026-11-11T18:00:00+09:00", "important": true, "estimated_minutes": 240}
 ],
 "assumptions": ["물리 과제: 2시간으로 추정"]}
```"""


def fake(reply, seen=None):
    def _call(system, user_message):
        if seen is not None:
            seen.append(user_message)
        return reply
    return _call


def test_parses_multiple_tasks(monkeypatch):
    seen = []
    monkeypatch.setattr(nlp, "call_llm", fake(GOOD, seen))
    r = nlp.parse_tasks_text("물리 과제 오늘 오후 10시까지\nINVIBE 최종 시연 내일 오후 6시까지", NOW)
    TaskBatchCreate(tasks=r["drafts"])  # 그대로 POST /tasks/batch 본문이 된다
    assert [d["name"] for d in r["drafts"]] == ["물리 과제", "INVIBE 최종 시연"]
    assert r["assumptions"] == ["물리 과제: 2시간으로 추정"]
    assert "화요일" in seen[0] and "2026-11-10 17:00" in seen[0]


def test_past_deadline_is_flagged(monkeypatch):
    monkeypatch.setattr(nlp, "call_llm", fake(GOOD.replace("2026-11-10T22", "2026-11-09T22")))
    r = nlp.parse_tasks_text("물리 과제 어제", NOW)
    assert any("지난" in a for a in r["assumptions"])


def test_bad_json_or_empty_raises(monkeypatch):
    monkeypatch.setattr(nlp, "call_llm", fake("모르겠어요"))
    with pytest.raises(nlp.ParseError):
        nlp.parse_tasks_text("??", NOW)
    monkeypatch.setattr(nlp, "call_llm", fake('{"tasks": []}'))
    with pytest.raises(nlp.ParseError):
        nlp.parse_tasks_text("??", NOW)


def test_missing_key_is_not_configured(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(nlp.NotConfigured):
        nlp.call_llm("s", "u")
