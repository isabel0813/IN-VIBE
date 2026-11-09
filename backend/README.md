# 바꿔도 돼? 백엔드

남은 시간에 맞춰 **꼭 해야 할 최소한의 일**을 계산하는 FastAPI 서버.
DB는 SQLite 파일 하나(`bakkwodo.db`)라 따로 띄울 필요가 없다.

## 실행

```bash
cd bakkwodo-backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m pytest -q                # 테스트 15개 통과 확인
uvicorn app.main:app --reload      # http://127.0.0.1:8000/docs 에서 바로 호출해 볼 수 있다
```

시연 데이터: `python -m scripts.seed_demo demo-user`

환경변수: `DB_PATH`(기본 `bakkwodo.db`), `CORS_ORIGINS`(기본 `*`, 배포 후 프론트 주소로 바꾸기)

## 프론트 연동 규칙

- **로그인 없음.** 처음 접속할 때 `crypto.randomUUID()`로 ID를 만들어 localStorage에 저장하고, 모든 요청에 `X-User-Id` 헤더로 보낸다.
- **시간은 ISO 8601.** 시간대를 빼고 보내면 한국 시간으로 본다. 예: `2026-11-11T23:59:00`
- **`now`는 시연용.** 비우면 서버 시각. 쿼리스트링에 `+09:00`을 넣을 땐 `encodeURIComponent`로 감싸야 한다(`+`가 공백으로 바뀜).
- 완료한 단위는 계획에서 빠진다. 계획은 저장하지 않고 요청할 때마다 다시 계산한다.

## API

| 메서드 | 경로 | 하는 일 |
| --- | --- | --- |
| GET | `/health` | 서버 확인 |
| POST | `/tasks` | 일 등록 |
| GET | `/tasks` | 내 일 목록(단위 포함) |
| GET / PATCH / DELETE | `/tasks/{id}` | 일 조회, 수정, 삭제 |
| PATCH | `/units/{id}` | 단위 완료 체크 `{"done": true}` |
| GET | `/plan?now=` | 현재 계획 (**핵심**) |
| POST | `/plan/wasted` | 시간 날렸어 |
| POST | `/plan/switch` | 다른 거 할래 |
| GET / PUT | `/settings` | 내일 이후 하루 사용 시간(기본 480분) |

### POST /tasks

```json
{
  "name": "물리 과제",
  "deadline": "2026-11-11T23:59:00",
  "important": true,
  "units": [
    {"name": "1번", "minutes": 20, "required": true},
    {"name": "4번", "minutes": 20}
  ]
}
```

필수(`required`)를 하나도 고르지 않으면 앞에서부터 절반(올림)을 필수로 정한다.
`PATCH /tasks/{id}`에 `units`를 보내면 단위 목록이 통째로 바뀐다.

### GET /plan 응답

```json
{
  "status": "short",
  "planned_minutes": 20,
  "free_minutes": 0,
  "next_unit": {"task_id": 1, "task_name": "물리 과제", "id": 11, "name": "1번", "minutes": 20, "required": true},
  "tasks": [
    {
      "task_id": 1, "name": "물리 과제", "deadline": "...", "important": true,
      "available_minutes": 20,
      "must": [],
      "extra": [],
      "short_required": [],
      "dropped": []
    }
  ],
  "overdue": []
}
```

- `status`: `ok`(여유 30분 이상) · `tight`(여유 30분 미만) · `short`(필수도 다 못 함)
- `must`: 지금 꼭 할 것 / `extra`: 여유 되면 할 것
- `short_required`: **필수인데 시간이 부족해서 못 하는 것** (빨간색으로 강조)
- `dropped`: 오늘은 포기하는 선택 단위
- `free_minutes`: 지금 딴짓해도 계획이 그대로인 시간
- `next_unit`: 지금 바로 할 단위

### POST /plan/wasted

```json
{"wasted_minutes": 30, "done_unit_ids": [11, 12]}
```

끝낸 단위를 체크한 뒤 계획을 다시 계산한다. 응답의 `newly_lost`는 날린 시간 때문에 **새로** 못 하게 된 단위, `plan`은 새 계획(`/plan`과 같은 모양).

### POST /plan/switch

```json
{"minutes": 40, "target_task_id": null}
```

- `target_task_id`가 비어 있으면 딴짓, 있으면 그 일을 진행한 것으로 계산한다.
- 응답: `safe_minutes`(괜찮은 시간), `is_safe`, `newly_lost`(넘기면 못 하게 되는 단위), `plan_after`

## 계산 규칙

1. 마감까지 쓸 수 있는 시간: 오늘 마감은 남은 시간 전부, 내일 이후는 오늘 남은 시간 + 하루 `daily_minutes`씩(실제 남은 시간을 넘지 않음)
2. 마감이 빠른 순, 같으면 중요 표시 순으로 정렬
3. 필수 단위부터, 그다음 나머지 단위를 하나씩 넣되 **모든 마감에서 "그 마감까지 배정한 시간 ≤ 쓸 수 있는 시간"** 을 지킬 때만 넣는다
4. 못 넣은 필수 단위는 `short_required`, 못 넣은 선택 단위는 `dropped`

`app/planner.py`가 이 계산만 담당하고 DB와 분리돼 있어서 `tests/test_planner.py`로 바로 검증할 수 있다.
