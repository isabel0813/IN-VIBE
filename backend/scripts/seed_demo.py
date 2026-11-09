"""시연용 데이터 넣기: python -m scripts.seed_demo demo-user

PRD 계산 예시와 같은 세 가지 일을 오늘 23:59 마감으로 만든다.
"""
import sys
from datetime import datetime, time

from app import db

user = sys.argv[1] if len(sys.argv) > 1 else "demo-user"
conn = db.connect()
deadline = datetime.combine(db.now_kst().date(), time(23, 59), tzinfo=db.KST)

for t in db.list_tasks(conn, user):
    db.delete_task(conn, user, t["id"])

db.create_task(conn, user, "물리 과제", deadline, True,
               [{"name": f"{i}번", "minutes": 20, "required": i <= 3} for i in range(1, 6)])
db.create_task(conn, user, "코딩 과제", deadline, True,
               [{"name": "필수 기능", "minutes": 90, "required": True},
                {"name": "추가 기능", "minutes": 60, "required": False}])
db.create_task(conn, user, "영어 단어", deadline, False,
               [{"name": "1챕터", "minutes": 30, "required": True},
                {"name": "2챕터", "minutes": 30, "required": False}])
print(f"{user}에 시연 데이터 3개를 넣었어 (마감 {deadline.isoformat()})")
