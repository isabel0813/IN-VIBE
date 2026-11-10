from datetime import datetime

import pytest

from app import db, planner


@pytest.fixture
def conn(tmp_path):
    c = db.connect(str(tmp_path / "test.db"))
    yield c
    c.close()


def make(conn, user="u1", name="물리 과제", minutes=120):
    return db.create_task(conn, user, name, datetime(2026, 11, 10, 22, 0), False, minutes)


def test_create_defaults_to_kst(conn):
    t = make(conn)
    assert t["deadline"].endswith("+09:00")
    assert t["estimated_minutes"] == 120 and t["done"] is False


def test_users_are_isolated(conn):
    t = make(conn, user="u1")
    assert db.get_task(conn, "u2", t["id"]) is None
    assert db.update_task(conn, "u2", t["id"], done=True) is None
    assert db.delete_task(conn, "u2", t["id"]) is False


def test_done_task_leaves_plan(conn):
    a = make(conn, name="물리")
    make(conn, name="영어", minutes=30)
    db.set_done(conn, "u1", [a["id"]])
    tasks = db.planner_tasks(conn, "u1")
    assert [t.name for t in tasks] == ["영어"]
    p = planner.build_plan(tasks, datetime(2026, 11, 10, 17, 0, tzinfo=db.KST))
    assert p["now_task"]["name"] == "영어"
    assert len(db.list_tasks(conn, "u1")) == 2


def test_update_fields_and_settings(conn):
    t = make(conn)
    t2 = db.update_task(conn, "u1", t["id"], name="물리 과제 2", estimated_minutes=90, important=True)
    assert (t2["name"], t2["estimated_minutes"], t2["important"]) == ("물리 과제 2", 90, True)
    assert db.get_daily_minutes(conn, "u1") == 480
    db.set_daily_minutes(conn, "u1", 300)
    assert db.get_daily_minutes(conn, "u1") == 300
