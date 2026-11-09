from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app import planner
from app.planner import Task, Unit

KST = ZoneInfo("Asia/Seoul")


def at(h, m=0, day=11):
    return datetime(2026, 11, day, h, m, tzinfo=KST)


def sample(deadline):
    """PRD 계산 예시: 세 일 모두 같은 마감, 물리와 코딩에 중요 표시."""
    return [
        Task(1, "물리", deadline, True,
             [Unit(10 + i, f"{i}번", 20, i <= 3, i) for i in range(1, 6)]),
        Task(2, "코딩", deadline, True,
             [Unit(21, "필수 기능", 90, True, 0), Unit(22, "추가 기능", 60, False, 1)]),
        Task(3, "영어", deadline, False,
             [Unit(31, "1챕터", 30, True, 0), Unit(32, "2챕터", 30, False, 1)]),
    ]


def names(plan, key):
    return [(t["name"], u["name"]) for t in plan["tasks"] for u in t[key]]


def test_four_hours_left():
    p = planner.build_plan(sample(at(23, 59)), at(19, 59))
    assert p["planned_minutes"] == 220
    assert p["free_minutes"] == 20
    assert ("물리", "5번") in names(p, "extra")
    assert names(p, "dropped") == [("코딩", "추가 기능"), ("영어", "2챕터")]
    assert p["status"] == "tight"


def test_three_hours_exactly_required():
    p = planner.build_plan(sample(at(23, 59)), at(20, 59))
    assert p["planned_minutes"] == 180
    assert p["free_minutes"] == 0
    assert names(p, "short_required") == []


def test_twenty_minutes_left_is_short():
    p = planner.build_plan(sample(at(23, 59)), at(23, 39))
    assert names(p, "must") == [("물리", "1번")]
    assert p["status"] == "short"
    assert ("코딩", "필수 기능") in names(p, "short_required")
    assert p["next_unit"]["name"] == "1번"


def test_earlier_deadline_protected():
    tasks = [
        Task(1, "늦은 일", at(23, 0), False, [Unit(1, "필수", 100, True)]),
        Task(2, "빠른 일", at(20, 0), False,
             [Unit(2, "필수", 30, True), Unit(3, "선택", 20, False, 1)]),
    ]
    p = planner.build_plan(tasks, at(19, 0))
    assert p["tasks"][0]["name"] == "빠른 일"
    assert p["free_minutes"] == 10
    assert names(p, "short_required") == []


def test_multi_day_uses_daily_minutes():
    now = at(20, 0, day=11)
    # 오늘 남은 240분 + 내일(마감 당일) min(480, 1439) = 720
    assert planner.available_minutes(now, at(23, 59, day=12), 480) == 720
    # 이틀 뒤: 240 + 480(중간 하루) + 480
    assert planner.available_minutes(now, at(23, 59, day=13), 480) == 1200
    # 다음 날 새벽 1시 마감은 실제 남은 300분을 넘지 않는다
    assert planner.available_minutes(now, at(1, 0, day=12), 480) == 300


def test_overdue_and_done_tasks():
    tasks = [Task(1, "지난 일", at(10), False, [Unit(1, "a", 10, True)]),
             Task(2, "다 한 일", at(23), False, [])]
    p = planner.build_plan(tasks, at(12))
    assert [t["name"] for t in p["overdue"]] == ["지난 일"]
    assert p["tasks"] == []
    assert p["free_minutes"] is None


def test_wasted_reports_newly_lost():
    r = planner.wasted_preview(sample(at(23, 59)), at(21, 29), wasted_minutes=30)
    lost = {(u["task_name"], u["name"]) for u in r["newly_lost"]}
    assert lost == {("영어", "1챕터")}
    assert r["plan"]["status"] == "short"


def test_switch_to_slacking_within_safe_time():
    r = planner.switch_preview(sample(at(23, 59)), at(19, 59), minutes=20)
    assert r["safe_minutes"] == 20
    assert r["is_safe"] is True


def test_switch_to_slacking_too_long():
    r = planner.switch_preview(sample(at(23, 59)), at(19, 59), minutes=40)
    assert r["is_safe"] is False
    assert ("물리", "5번") in {(u["task_name"], u["name"]) for u in r["newly_lost"]}


def test_switch_to_another_planned_task_costs_nothing():
    # 같은 마감인 코딩으로 바꿔 필수 기능을 90분 진행하면 잃는 게 없다
    r = planner.switch_preview(sample(at(23, 59)), at(19, 59), minutes=90, target_task_id=2)
    assert r["is_safe"] is True
