"""자연어로 적은 할 일 목록을 초안으로 바꾼다.

예) "물리 과제 오늘 오후 10시까지\nINVIBE 최종 시연 내일 오후 6시까지"
결과는 저장하지 않고 초안만 돌려준다. 사용자가 확인·수정한 뒤 POST /tasks/batch 로 저장한다.
외부 라이브러리 없이 표준 라이브러리로 API를 호출한다.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime

from pydantic import ValidationError

from .schemas import TaskCreate

API_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_MODEL = "claude-haiku-5-5"
WEEKDAYS = "월화수목금토일"

SYSTEM_PROMPT = """너는 대학생이 자연어로 적은 할 일 목록을 구조화하는 도우미야.
설명 없이 JSON 객체 하나만 출력해.

형식:
{"tasks": [{"name": "짧은 작업 이름",
            "deadline": "YYYY-MM-DDTHH:MM:00+09:00",
            "important": false,
            "estimated_minutes": 120}],
 "assumptions": ["추정한 내용"]}

규칙:
- 줄이나 쉼표로 구분된 일을 각각 하나의 task로 만들어. 일 안의 내용을 쪼개지 마.
- 날짜는 주어진 현재 시각을 기준으로 계산해. "오늘", "내일", "금요일"도 날짜로 바꿔.
- "오후 10시" → 22:00, "밤 12시"는 그날 23:59로. 시각이 없으면 그날 23:59.
- 사용자가 걸리는 시간을 말했으면 estimated_minutes에 그대로 넣어.
- 말하지 않았으면 일 이름으로 대학생 기준 현실적인 시간을 추정하고 assumptions에 "물리 과제: 2시간으로 추정"처럼 적어.
- "중요", "급해", "꼭" 같은 말이 있으면 important를 true로.
"""


class NotConfigured(RuntimeError):
    """API 키가 없어서 자연어 등록을 쓸 수 없음."""


class ParseError(RuntimeError):
    """모델 응답을 할 일로 바꾸지 못함."""


def build_user_message(text: str, now: datetime) -> str:
    return (
        f"현재 시각: {now:%Y-%m-%d %H:%M} ({WEEKDAYS[now.weekday()]}요일), 시간대 Asia/Seoul\n"
        f"할 일 목록:\n{text}"
    )


def call_llm(system: str, user_message: str) -> str:
    """모델을 호출해 응답 텍스트를 돌려준다. 테스트에서는 이 함수를 바꿔 끼운다."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise NotConfigured("자연어 등록을 쓰려면 서버에 ANTHROPIC_API_KEY를 설정해야 해요")

    body = json.dumps({
        "model": os.getenv("LLM_MODEL", DEFAULT_MODEL),
        "max_tokens": 1024,
        "system": system,
        "messages": [{"role": "user", "content": user_message}],
    }).encode("utf-8")
    req = urllib.request.Request(
        API_URL, data=body, method="POST",
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        raise ParseError(f"AI 호출 실패 ({e.code}): {detail}") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise ParseError(f"AI 서버에 연결하지 못했어요: {e}") from e

    texts = [b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"]
    if not texts:
        raise ParseError("AI 응답이 비어 있어요")
    return "".join(texts)


def _extract_json(raw: str) -> dict:
    cleaned = re.sub(r"```(?:json)?", "", raw).strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end <= start:
        raise ParseError("AI 응답에서 JSON을 찾지 못했어요")
    try:
        return json.loads(cleaned[start:end + 1])
    except json.JSONDecodeError as e:
        raise ParseError("AI 응답 JSON 형식이 올바르지 않아요") from e


def parse_tasks_text(text: str, now: datetime) -> dict:
    """자연어 목록 → 할 일 초안 목록. drafts는 POST /tasks/batch의 tasks로 그대로 쓸 수 있다."""
    data = _extract_json(call_llm(SYSTEM_PROMPT, build_user_message(text, now)))
    assumptions = [str(a) for a in data.get("assumptions") or []]
    raw_tasks = data.get("tasks") or []
    if not raw_tasks:
        raise ParseError("할 일을 하나도 찾지 못했어요")

    drafts = []
    for raw in raw_tasks:
        try:
            draft = TaskCreate(**raw)
        except ValidationError as e:
            raise ParseError(f"할 일 형식이 올바르지 않아요: {e.errors()[0].get('msg')}") from e
        deadline = draft.deadline if draft.deadline.tzinfo else draft.deadline.replace(tzinfo=now.tzinfo)
        if deadline <= now:
            assumptions.append(f"{draft.name}: 마감이 이미 지난 시각으로 읽혔어요. 날짜를 확인해 주세요")
        drafts.append(draft.model_dump(mode="json"))

    return {"drafts": drafts, "assumptions": assumptions}
