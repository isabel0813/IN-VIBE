"""시연용 데이터 넣기: python -m scripts.seed_demo demo-user

오늘 22시 마감 물리 과제(2시간)와 내일 18시 마감 INVIBE 최종 시연(4시간)을 만든다.
"""
import sys
from datetime import datetime, time, timedelta

from app import db

user = sys.argv[1] if len(sys.argv) > 1 else "demo-user"
conn = db.connect()
today = db.now_kst().date()

for t in db.list_tasks(conn, user):
    db.delete_task(conn, user, t["id"])

db.create_task(conn, user, "물리 과제", datetime.combine(today, time(22, 0), tzinfo=db.KST), False, 120)
db.create_task(conn, user, "INVIBE 최종 시연",
               datetime.combine(today + timedelta(days=1), time(18, 0), tzinfo=db.KST), True, 240)
print(f"{user}에 시연 데이터 2개를 넣었어")
