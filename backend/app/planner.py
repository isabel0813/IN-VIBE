"""남은 시간에 맞춰 '꼭 해야 할 최소한의 일'을 계산하는 순수 로직.

DB나 FastAPI에 의존하지 않으므로 단독으로 테스트할 수 있다.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta


@dataclass
class Unit:
    id: int
    name: str
    minutes: int
    required: bool
    order: int = 0


@dataclass
class Task:
    id: int
    name: str
    deadline: datetime
    important: bool
    units: list[Unit] = field(default_factory=list)  # 아직 안 끝낸 단위만 넣는다


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


def _unit_dict(u: Unit) -> dict:
    return {"id": u.id, "name": u.name, "minutes": u.minutes, "required": u.required}


def build_plan(tasks: list[Task], now: datetime, daily_minutes: int = 480) -> dict:
    """마감이 빠른 순으로 필수 단위부터 시간을 배정한다.

    단위 하나를 넣을 때마다 '모든 마감에서 그 마감까지 배정한 시간 <= 쓸 수 있는 시간'을
    만족하는지 확인하고, 어긋나면 넣지 않는다.
    """
    overdue = [t for t in tasks if available_minutes(now, t.deadline, daily_minutes) <= 0]
    active = [t for t in tasks if t not in overdue and t.units]
    active.sort(key=lambda t: (t.deadline, not t.important, t.id))
    avail = {t.id: available_minutes(now, t.deadline, daily_minutes) for t in active}

    picked: list[tuple[int, int]] = []  # (그 일의 쓸 수 있는 시간, 배정한 분)

    def fits(trial: list[tuple[int, int]]) -> bool:
        for limit, _ in trial:
            if sum(m for lim, m in trial if lim <= limit) > limit:
                return False
        return True

    assigned: dict[int, set[int]] = {t.id: set() for t in active}
    for phase_required in (True, False):
        for t in active:
            for u in sorted(t.units, key=lambda x: x.order):
                if u.required != phase_required:
                    continue
                trial = picked + [(avail[t.id], u.minutes)]
                if fits(trial):
                    picked = trial
                    assigned[t.id].add(u.id)

    result_tasks = []
    order_to_do = []
    short_any = False
    for t in active:
        units = sorted(t.units, key=lambda x: x.order)
        must = [u for u in units if u.required and u.id in assigned[t.id]]
        extra = [u for u in units if not u.required and u.id in assigned[t.id]]
        short = [u for u in units if u.required and u.id not in assigned[t.id]]
        dropped = [u for u in units if not u.required and u.id not in assigned[t.id]]
        short_any = short_any or bool(short)
        order_to_do += [(t, u) for u in must]
        result_tasks.append({
            "task_id": t.id,
            "name": t.name,
            "deadline": t.deadline.isoformat(),
            "important": t.important,
            "available_minutes": avail[t.id],
            "must": [_unit_dict(u) for u in must],
            "extra": [_unit_dict(u) for u in extra],
            "short_required": [_unit_dict(u) for u in short],
            "dropped": [_unit_dict(u) for u in dropped],
        })
    for t in active:
        order_to_do += [(t, u) for u in sorted(t.units, key=lambda x: x.order)
                        if not u.required and u.id in assigned[t.id]]

    if active:
        free = min(
            avail[t.id] - sum(m for lim, m in picked if lim <= avail[t.id])
            for t in active
        )
    else:
        free = None

    if short_any:
        status = "short"      # 필수 단위도 다 못 함
    elif free is not None and free < 30:
        status = "tight"      # 여유 30분 미만
    else:
        status = "ok"

    next_unit = None
    if order_to_do:
        t, u = order_to_do[0]
        next_unit = {"task_id": t.id, "task_name": t.name, **_unit_dict(u)}

    return {
        "now": now.isoformat(),
        "status": status,
        "planned_minutes": sum(m for _, m in picked),
        "free_minutes": free,
        "next_unit": next_unit,
        "tasks": result_tasks,
        "overdue": [{"task_id": t.id, "name": t.name, "deadline": t.deadline.isoformat()}
                    for t in overdue],
    }


def _lost_ids(plan: dict) -> set[int]:
    return {u["id"] for t in plan["tasks"] for u in t["short_required"] + t["dropped"]} | {
        -t["task_id"] for t in plan["overdue"]  # 마감이 지난 일은 음수 id로 구분
    }


def newly_lost(before: dict, after: dict) -> list[dict]:
    """before 계획에서는 할 수 있었는데 after에서는 못 하게 된 단위 목록."""
    gone = _lost_ids(after) - _lost_ids(before)
    out = []
    for t in after["tasks"]:
        for kind in ("short_required", "dropped"):
            for u in t[kind]:
                if u["id"] in gone:
                    out.append({"task_id": t["task_id"], "task_name": t["name"],
                                "required": u["required"], **u})
    for t in after["overdue"]:
        if -t["task_id"] in gone:
            out.append({"task_id": t["task_id"], "task_name": t["name"], "overdue": True})
    return out


def wasted_preview(tasks: list[Task], now: datetime, wasted_minutes: int,
                   daily_minutes: int = 480) -> dict:
    """'시간 날렸어': 날린 시간 전(now - wasted)과 지금의 계획을 비교한다."""
    before = build_plan(tasks, now - timedelta(minutes=wasted_minutes), daily_minutes)
    after = build_plan(tasks, now, daily_minutes)
    return {"wasted_minutes": wasted_minutes, "newly_lost": newly_lost(before, after), "plan": after}


def switch_preview(tasks: list[Task], now: datetime, minutes: int,
                   target_task_id: int | None = None, daily_minutes: int = 480) -> dict:
    """'다른 거 할래': minutes 동안 다른 걸 하면 계획이 어떻게 바뀌는지 미리 보여준다.

    target_task_id가 있으면 그 시간을 해당 일의 단위를 순서대로 진행한 것으로 친다.
    없으면 딴짓으로 보고 아무 일도 진행되지 않은 것으로 친다.
    """
    before = build_plan(tasks, now, daily_minutes)
    sim = copy.deepcopy(tasks)
    if target_task_id is not None:
        left = minutes
        for t in sim:
            if t.id != target_task_id:
                continue
            remaining = []
            for u in sorted(t.units, key=lambda x: x.order):
                if left >= u.minutes:
                    left -= u.minutes          # 이 단위는 끝난 것으로 본다
                    continue
                u.minutes -= left              # 일부만 진행
                left = 0
                remaining.append(u)
            t.units = remaining
    after = build_plan(sim, now + timedelta(minutes=minutes), daily_minutes)
    return {
        "minutes": minutes,
        "target_task_id": target_task_id,
        "safe_minutes": before["free_minutes"],
        "is_safe": not newly_lost(before, after),
        "newly_lost": newly_lost(before, after),
        "plan_after": after,
    }
