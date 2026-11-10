from datetime import datetime
from zoneinfo import ZoneInfo

from app import planner
from app.planner import Task

KST = ZoneInfo("Asia/Seoul")


def at(h, m=0, day=10):
    return datetime(2026, 11, day, h, m, tzinfo=KST)


def sample():
    # 오늘 오후 5시 기준: 물리 오늘 22시(2시간), INVIBE 내일 18시(4시간)
    return [
        Task(2, "INVIBE 최종 시연", at(18, day=11), True, 240),
        Task(1, "물리 과제", at(22), False, 120),
    ]


def test_now_task_is_earliest_deadline():
    p = planner.build_plan(sample(), at(17))
    assert p["now_task"]["name"] == "물리 과제"
    assert [o["name"] for o in p["order"]] == ["물리 과제", "INVIBE 최종 시연"]
    assert p["status"] == "ok"
    # 물리 마감까지 300분 중 120분 사용 → 여유 180분
    assert p["free_minutes"] == 180
    assert p["start_by"] == at(20).isoformat()


def test_important_breaks_tie():
    tasks = [Task(1, "보통", at(22), False, 60), Task(2, "중요", at(22), True, 60)]
    p = planner.build_plan(tasks, at(17))
    assert p["now_task"]["name"] == "중요"


def test_short_when_not_enough_time():
    p = planner.build_plan(sample(), at(21))
    physics = p["order"][0]
    assert physics["assigned_minutes"] == 60 and physics["short_minutes"] == 60
    assert p["status"] == "short"
    assert p["start_by"] is None


def test_earlier_task_squeezes_later_one():
    tasks = [Task(1, "A", at(19), False, 90), Task(2, "B", at(20), False, 60)]
    p = planner.build_plan(tasks, at(17))
    # B는 마감까지 180분인데 A가 90분을 먼저 써서 60분 모두 가능, 여유는 30분
    assert p["order"][1]["short_minutes"] == 0
    assert p["free_minutes"] == 30
    assert p["status"] == "ok"


def test_multi_day_available_minutes():
    now = at(20, day=10)
    assert planner.available_minutes(now, at(23, 59, day=11), 480) == 720
    assert planner.available_minutes(now, at(23, 59, day=12), 480) == 1200
    assert planner.available_minutes(now, at(1, 0, day=11), 480) == 300


def test_overdue_and_empty():
    p = planner.build_plan([Task(1, "지난 일", at(10), False, 30)], at(12))
    assert p["overdue"][0]["name"] == "지난 일"
    assert p["now_task"] is None and p["free_minutes"] is None
    assert planner.build_plan([], at(12))["status"] == "ok"


def test_wasted_reports_impacts():
    r = planner.wasted_preview(sample(), at(21), wasted_minutes=60)
    assert r["impacts"] == [{"task_id": 1, "name": "물리 과제", "lost_minutes": 60, "short_minutes": 60}]
    assert r["plan"]["status"] == "short"


def test_wasted_without_impact():
    r = planner.wasted_preview(sample(), at(18), wasted_minutes=30)
    assert r["impacts"] == []
    assert r["now_task_changed"] is False
