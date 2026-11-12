"""요청 본문 검증용 Pydantic 모델."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class TaskCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    deadline: datetime = Field(description="ISO 8601. 시간대가 없으면 한국 시간으로 본다")
    important: bool = False
    estimated_minutes: int = Field(60, ge=5, le=6000, description="이 일 전체에 걸릴 예상 시간(분)")


class TaskBatchCreate(BaseModel):
    tasks: list[TaskCreate] = Field(min_length=1, max_length=30)


class TaskUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    deadline: datetime | None = None
    important: bool | None = None
    estimated_minutes: int | None = Field(None, ge=5, le=6000)
    done: bool | None = Field(None, description="true면 완료 처리, 계획에서 빠진다")


class ParseIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000,
                      description="한 줄에 하나씩. 예: 물리 과제 오늘 오후 10시까지")
    now: datetime | None = Field(None, description="시연용 현재 시각. 비우면 서버 시각")


class WastedIn(BaseModel):
    wasted_minutes: int = Field(0, ge=0, le=1440, description="딴짓한 시간(분)")
    done_task_ids: list[int] = Field(default_factory=list, description="그 사이 끝낸 일")
    now: datetime | None = Field(None, description="시연용 현재 시각. 비우면 서버 시각")


class EventIn(BaseModel):
    type: str = Field(min_length=1, max_length=40, description="metrics.CLIENT_EVENTS 중 하나")
    task_id: int | None = None
    payload: dict = Field(default_factory=dict, description="작은 부가 정보. 개인정보·창 제목은 넣지 않는다")


class SessionIn(BaseModel):
    task: str = Field(min_length=1, max_length=100, description="지금 할 일 한 줄. 예: 전자기 유도 공부")


class SessionEnd(BaseModel):
    reason: Literal["completed", "stopped"] = "stopped"


class JudgeIn(BaseModel):
    session_id: int
    title: str = Field(min_length=1, max_length=400, description="유튜브 영상 제목. 서버에 저장하지 않는다")
    video_id: str | None = Field(None, pattern=r"^[A-Za-z0-9_-]{11}$",
                                 description="11자 영상 ID. 같은 영상 판단을 재사용하는 데만 쓴다")


class JudgeFeedbackIn(BaseModel):
    session_id: int
    title: str = Field(min_length=1, max_length=400)
    video_id: str | None = Field(None, pattern=r"^[A-Za-z0-9_-]{11}$")


class SettingsIn(BaseModel):
    daily_minutes: int = Field(ge=60, le=1440, description="내일 이후 하루에 쓸 수 있는 시간(분)")
