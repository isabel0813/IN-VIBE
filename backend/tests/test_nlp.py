import json
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
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(nlp.NotConfigured):
        nlp.call_llm("s", "u")


def test_date_table_in_prompt():
    msg = nlp.build_user_message("x", NOW)
    assert "- 오늘: 2026-11-10 (화요일)" in msg
    assert "- 내일: 2026-11-11 (수요일)" in msg
    assert "- 3일 뒤: 2026-11-13 (금요일)" in msg


class FakeResp:
    def __init__(self, body):
        self.body = body

    def read(self):
        return self.body.encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_ollama_request_and_response(monkeypatch):
    sent = {}

    def fake_urlopen(req, timeout):
        sent["url"] = req.full_url
        sent["body"] = json.loads(req.data.decode("utf-8"))
        return FakeResp(json.dumps({"message": {"role": "assistant", "content": '{"tasks": []}'}}))

    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.setenv("OLLAMA_MODEL", "qwen2.5:7b")
    monkeypatch.delenv("OLLAMA_URL", raising=False)
    monkeypatch.setattr(nlp.urllib.request, "urlopen", fake_urlopen)
    assert nlp.call_llm("sys", "user") == '{"tasks": []}'
    assert sent["url"] == "http://localhost:11434/api/chat"
    assert sent["body"]["model"] == "qwen2.5:7b"
    assert sent["body"]["stream"] is False and sent["body"]["format"] == "json"
    assert sent["body"]["messages"][0] == {"role": "system", "content": "sys"}


def test_ollama_not_running(monkeypatch):
    def refuse(req, timeout):
        raise nlp.urllib.error.URLError("Connection refused")

    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.setattr(nlp.urllib.request, "urlopen", refuse)
    with pytest.raises(nlp.ParseError):
        nlp.call_llm("s", "u")


def test_default_provider_is_anthropic(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(nlp.NotConfigured):
        nlp.call_llm("s", "u")
