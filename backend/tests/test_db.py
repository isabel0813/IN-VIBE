from datetime import datetime

import pytest

from app import db, planner
from app.schemas import TaskCreate


@pytest.fixture
def conn(tmp_path):
    c = db.connect(str(tmp_path / "test.db"))
    yield c
    c.close()


def make(conn, user="u1", **kw):
    body = TaskCreate(**{
        "name": "물리 과제",
        "deadline": "2026-11-11T23:59:00",
        "units": [{"name": f"{i}번", "minutes": 20} for i in range(1, 6)],
        **kw,
    })
    return db.create_task(conn, user, body.name, body.deadline, body.important,
                          [u.model_dump() for u in body.units])


def test_default_required_is_first_half(conn):
    t = make(conn)
    assert [u["required"] for u in t["units"]] == [True, True, True, False, False]
    assert t["deadline"].endswith("+09:00")


def test_users_are_isolated(conn):
    t = make(conn, user="u1")
    assert db.get_task(conn, "u2", t["id"]) is None
    assert db.set_units_done(conn, "u2", [t["units"][0]["id"]]) == []
    assert db.delete_task(conn, "u2", t["id"]) is False


def test_done_units_leave_plan(conn):
    t = make(conn)
    db.set_units_done(conn, "u1", [t["units"][0]["id"]])
    tasks = db.planner_tasks(conn, "u1")
    assert len(tasks[0].units) == 4
    now = datetime(2026, 11, 11, 23, 0, tzinfo=db.KST)
    p = planner.build_plan(tasks, now)
    assert [u["name"] for u in p["tasks"][0]["must"]] == ["2번", "3번"]


def test_update_replaces_units_and_settings(conn):
    t = make(conn)
    t2 = db.update_task(conn, "u1", t["id"], units=[{"name": "전체", "minutes": 60, "required": True}])
    assert [u["name"] for u in t2["units"]] == ["전체"]
    assert db.get_daily_minutes(conn, "u1") == 480
    db.set_daily_minutes(conn, "u1", 300)
    assert db.get_daily_minutes(conn, "u1") == 300


def test_delete_cascades_units(conn):
    t = make(conn)
    db.delete_task(conn, "u1", t["id"])
    assert conn.execute("SELECT COUNT(*) FROM units").fetchone()[0] == 0
