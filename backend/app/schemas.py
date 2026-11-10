"""요청 본문 검증용 Pydantic 모델."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class UnitIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    minutes: int = Field(ge=1, le=1440, description="이 단위에 걸릴 예상 시간(분)")
    required: bool = Field(False, description="꼭 해야 하는 최소한의 일인지")


class TaskCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    deadline: datetime = Field(description="ISO 8601. 시간대가 없으면 한국 시간으로 본다")
    important: bool = False
    units: list[UnitIn] = Field(min_length=1, max_length=100)


class TaskUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    deadline: datetime | None = None
    important: bool | None = None
    units: list[UnitIn] | None = Field(None, min_length=1, description="보내면 단위 목록을 통째로 교체")


class UnitDone(BaseModel):
    done: bool = True


class WastedIn(BaseModel):
    wasted_minutes: int = Field(0, ge=0, le=1440, description="날린 시간(분). 0이면 비교 없이 새 계획만")
    done_unit_ids: list[int] = Field(default_factory=list, description="그 사이 끝낸 단위")
    now: datetime | None = Field(None, description="시연용 현재 시각. 비우면 서버 시각")


class SwitchIn(BaseModel):
    minutes: int = Field(ge=1, le=1440, description="다른 일이나 딴짓에 쓸 시간(분)")
    target_task_id: int | None = Field(None, description="다른 일로 바꿀 때 그 일의 id. 딴짓이면 비움")
    now: datetime | None = None


class ParseIn(BaseModel):
    text: str = Field(min_length=1, max_length=500, description="예: 물리 과제 내일 밤 12시까지, 5문제")
    now: datetime | None = Field(None, description="시연용 현재 시각. 비우면 서버 시각")


class SettingsIn(BaseModel):
    daily_minutes: int = Field(ge=60, le=1440, description="내일 이후 하루에 쓸 수 있는 시간(분)")
