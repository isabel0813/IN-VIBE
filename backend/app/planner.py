"""남은 시간 안에서 '지금 무엇을 할지'를 정하는 순수 로직.

일(과목) 단위로 계산한다. 일마다 마감과 총 예상 시간만 있으면 된다.
DB나 FastAPI에 의존하지 않으므로 단독으로 테스트할 수 있다.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta


@dataclass
class Task:
    id: int
    name: str
    deadline: datetime
    important: bool
    estimated_minutes: int


def available_minutes(now: datetime, deadline: datetime, daily_minutes: int) -> int:
    """지금부터 마감까지 실제로 쓸 수 있는 시간(분).

    - 오늘 마감: 마감까지 남은 시간 전부
    - 내일 이후 마감: 오늘 남은 시간 + 사이 날짜마다 daily_minutes
      + 마감 당일은 min(daily_minutes, 그날 0시부터 마감까지)
    - 어떤 경우에도 실제 남은 시간을 넘지 않는다.
    """
    deadline = deadline.astimezone(now.tzinfo) if now.tzinfo else deadline
    if deadline <= now:
        return 0
    real_left = int((deadline - now).total_seconds() // 60)
    if deadline.date() == now.date():
        return real_left

    midnight = datetime.combine(now.date() + timedelta(days=1), time(0), tzinfo=now.tzinfo)
    rest_today = int((midnight - now).total_seconds() // 60)
    full_days = (deadline.date() - now.date()).days - 1
    day_start = datetime.combine(deadline.date(), time(0), tzinfo=deadline.tzinfo)
    last_day = int((deadline - day_start).total_seconds() // 60)

    estimate = rest_today + daily_minutes * full_days + min(daily_minutes, last_day)
    return min(estimate, real_left)


def build_plan(tasks: list[Task], now: datetime, daily_minutes: int = 480) -> dict:
    """마감이 빠른 순(같으면 중요한 일 먼저)으로 시간을 배정한다.

    앞선 일에 배정한 시간을 빼고 남는 만큼만 뒤의 일에 줄 수 있다.
    예상 시간보다 적게 배정되면 그만큼이 '부족한 시간'이다.
    """
    overdue = [t for t in tasks if available_minutes(now, t.deadline, daily_minutes) <= 0]
    active = sorted((t for t in tasks if t not in overdue),
                    key=lambda t: (t.deadline, not t.important, t.id))

    used = 0
    order = []
    free = None
    for t in active:
        avail = available_minutes(now, t.deadline, daily_minutes)
        assigned = max(0, min(t.estimated_minutes, avail - used))
        used += assigned
        slack = avail - used
        free = slack if free is None else min(free, slack)
        order.append({
            "task_id": t.id,
            "name": t.name,
            "deadline": t.deadline.isoformat(),
            "important": t.important,
            "estimated_minutes": t.estimated_minutes,
            "minutes_until_deadline": int((t.deadline - now).total_seconds() // 60),
            "assigned_minutes": assigned,
            "short_minutes": t.estimated_minutes - assigned,
        })
    if free is not None:
        free = max(free, 0)

    short = [o for o in order if o["short_minutes"] > 0]
    if short:
        status = "short"   # 예상 시간을 다 못 쓰는 일이 있음
    elif free is not None and free < 30:
        status = "tight"   # 여유 30분 미만
    else:
        status = "ok"

    now_task = next((o for o in order if o["assigned_minutes"] > 0), None)
    start_by = (now + timedelta(minutes=free)).isoformat() if free is not None and not short else None

    return {
        "now": now.isoformat(),
        "status": status,
        "now_task": now_task,          # 지금 할 일
        "order": order,                # 해야 할 순서
        "free_minutes": free,          # 지금 딴짓해도 계획이 그대로인 시간
        "start_by": start_by,          # 이 시각까지 시작하면 모든 일을 예상 시간만큼 할 수 있음
        "overdue": [{"task_id": t.id, "name": t.name, "deadline": t.deadline.isoformat()}
                    for t in overdue],
    }


def _shortages(plan: dict) -> dict[int, int]:
    out = {o["task_id"]: o["short_minutes"] for o in plan["order"]}
    out.update({o["task_id"]: -1 for o in plan["overdue"]})  # -1 = 마감 지남
    return out


def wasted_preview(tasks: list[Task], now: datetime, wasted_minutes: int,
                   daily_minutes: int = 480) -> dict:
    """고해성사: 날린 시간 전(now - wasted)과 지금의 계획을 비교한다."""
    before = build_plan(tasks, now - timedelta(minutes=wasted_minutes), daily_minutes)
    after = build_plan(tasks, now, daily_minutes)
    b, a = _shortages(before), _shortages(after)
    impacts = []
    for o in after["order"]:
        extra = o["short_minutes"] - b.get(o["task_id"], 0)
        if extra > 0:
            impacts.append({"task_id": o["task_id"], "name": o["name"],
                            "lost_minutes": extra, "short_minutes": o["short_minutes"]})
    for o in after["overdue"]:
        if b.get(o["task_id"]) != -1:
            impacts.append({"task_id": o["task_id"], "name": o["name"], "overdue": True})
    return {
        "wasted_minutes": wasted_minutes,
        "now_task_changed": (before["now_task"] or {}).get("task_id") != (after["now_task"] or {}).get("task_id"),
        "impacts": impacts,           # 날린 시간 때문에 시간이 모자라게 된 일
        "plan": after,
    }
