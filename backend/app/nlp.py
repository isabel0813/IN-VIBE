"""자연어 한 줄을 할 일 초안으로 바꾼다.

결과는 저장하지 않고 초안만 돌려준다. 프론트에서 사용자가 확인·수정한 뒤
POST /tasks 로 저장하는 흐름이다. 외부 라이브러리 없이 표준 라이브러리로 API를 호출한다.
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

SYSTEM_PROMPT = """너는 대학생이 한 줄로 적은 할 일을 구조화하는 도우미야.
설명 없이 JSON 객체 하나만 출력해.

형식:
{"name": "짧은 작업 이름",
 "deadline": "YYYY-MM-DDTHH:MM:00+09:00",
 "important": false,
 "units": [{"name": "단위 이름", "minutes": 20, "required": true}],
 "assumptions": ["추정한 내용"]}

규칙:
- 날짜는 주어진 현재 시각을 기준으로 계산해. "내일", "금요일", "이번 주"도 날짜로 바꿔.
- 시각이 없으면 그날 23:59로 해.
- 분량(문제 수, 챕터, 페이지, 강의 수)이 있으면 그 단위로 나눠.
- 분량이 없으면 15~60분짜리 단위 2~5개로 나눠.
- 사용자가 총 시간을 말했으면 단위 시간의 합을 거기에 맞춰.
- required는 이것만 해도 제출이나 최소 완료가 되는 단위에 true. 판단이 어려우면 앞쪽 절반을 true로.
- "중요", "급해", "꼭" 같은 말이 있으면 important를 true로.
- 문장에 없는 걸 추정했다면 assumptions에 한국어로 짧게 적어. 없으면 빈 배열.
"""


class NotConfigured(RuntimeError):
    """API 키가 없어서 자연어 등록을 쓸 수 없음."""


class ParseError(RuntimeError):
    """모델 응답을 할 일로 바꾸지 못함."""


def build_user_message(text: str, now: datetime) -> str:
    return (
        f"현재 시각: {now:%Y-%m-%d %H:%M} ({WEEKDAYS[now.weekday()]}요일), 시간대 Asia/Seoul\n"
        f"할 일: {text}"
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
        API_URL,
        data=body,
        method="POST",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
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


def parse_task_text(text: str, now: datetime) -> dict:
    """자연어를 할 일 초안으로 바꾼다. 반환값의 draft는 POST /tasks 본문으로 그대로 쓸 수 있다."""
    data = _extract_json(call_llm(SYSTEM_PROMPT, build_user_message(text, now)))
    assumptions = [str(a) for a in data.pop("assumptions", []) or []]
    try:
        draft = TaskCreate(**data)
    except ValidationError as e:
        raise ParseError(f"할 일 형식이 올바르지 않아요: {e.errors()[0].get('msg')}") from e

    deadline = draft.deadline if draft.deadline.tzinfo else draft.deadline.replace(tzinfo=now.tzinfo)
    if deadline <= now:
        assumptions.append("마감이 이미 지난 시각으로 읽혔어요. 날짜를 확인해 주세요")

    return {"draft": draft.model_dump(mode="json"), "assumptions": assumptions}
