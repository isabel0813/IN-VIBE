# 바꿔도 돼? 백엔드

할 일을 자연어로 받아서, 남은 시간 기준으로 **지금 무엇을 할지**를 정해주는 FastAPI 서버.
일(과목) 단위로 계산하며, 일 안의 내용은 쪼개지 않는다. DB는 SQLite 파일 하나(`bakkwodo.db`)다.

## 실행

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m pytest -q                # 테스트 16개 통과 확인
uvicorn app.main:app --reload      # http://127.0.0.1:8000/docs 에서 바로 호출해 볼 수 있다
```

시연 데이터: `python -m scripts.seed_demo demo-user`

환경변수
- `DB_PATH`: 기본 `bakkwodo.db`
- `CORS_ORIGINS`: 기본 `*`
- `ANTHROPIC_API_KEY`: 자연어 등록(`/tasks/parse`)에 필요. 없으면 그 API만 503을 돌려주고 나머지는 정상 동작
- `LLM_MODEL`: 기본 `claude-haiku-5-5`

## 프론트 연동 규칙

- **로그인 없음.** 처음 실행할 때 UUID를 만들어 저장하고, 모든 요청에 `X-User-Id` 헤더로 보낸다.
- **시간은 ISO 8601.** 시간대를 빼고 보내면 한국 시간으로 본다. 예: `2026-11-11T18:00:00`
- **`now`는 시연용.** 비우면 서버 시각. 쿼리스트링에 `+09:00`을 넣을 땐 `encodeURIComponent`로 감싼다.
- 완료한 일은 계획에서 빠진다. 계획은 저장하지 않고 요청할 때마다 다시 계산한다.
- 진행 시간은 기록하지 않는다(MVP). 일이 끝나면 완료 체크만 한다.

## API

| 메서드 | 경로 | 하는 일 |
| --- | --- | --- |
| GET | `/health` | 서버 확인 |
| POST | `/tasks/parse` | 자연어 목록 → 할 일 초안 (저장 안 함) |
| POST | `/tasks/batch` | 초안 여러 개를 한 번에 저장 |
| POST | `/tasks` | 일 하나 저장 |
| GET | `/tasks?include_done=true` | 내 일 목록 |
| GET / PATCH / DELETE | `/tasks/{id}` | 일 조회, 수정(완료 체크 포함), 삭제 |
| GET | `/plan?now=` | 지금 할 일과 순서 (**핵심**) |
| POST | `/plan/wasted` | 고해성사 |
| GET / PUT | `/settings` | 내일 이후 하루 사용 시간(기본 480분) |

### 1. 자연어 등록: POST /tasks/parse → POST /tasks/batch

```json
{"text": "물리 과제 오늘 오후 10시까지\nINVIBE 최종 시연 내일 오후 6시까지"}
```

응답:

```json
{
  "drafts": [
    {"name": "물리 과제", "deadline": "2026-11-10T22:00:00+09:00", "important": false, "estimated_minutes": 120},
    {"name": "INVIBE 최종 시연", "deadline": "2026-11-11T18:00:00+09:00", "important": false, "estimated_minutes": 240}
  ],
  "assumptions": ["물리 과제: 2시간으로 추정", "INVIBE 최종 시연: 4시간으로 추정"]
}
```

확인 화면에서 `drafts`와 `assumptions`를 보여주고 예상 시간 등을 고치게 한 뒤, 확정하면
`{"tasks": drafts}`를 `POST /tasks/batch`로 보낸다.
- `503`: 서버에 API 키가 없음 → 직접 입력 폼으로
- `422`: AI가 문장을 이해하지 못함 → 다시 입력하거나 직접 입력 폼으로

`POST /tasks`(하나 저장)의 본문은 draft 하나와 같은 모양이다. `estimated_minutes`를 빼면 60분.

### 2. 완료 체크: PATCH /tasks/{id}

```json
{"done": true}
```

이름, 마감, 중요, 예상 시간도 같은 API로 고친다.

### 3. 계획: GET /plan

```json
{
  "status": "ok",
  "now_task": {
    "task_id": 1, "name": "물리 과제", "deadline": "2026-11-10T22:00:00+09:00",
    "important": false, "estimated_minutes": 120,
    "minutes_until_deadline": 300, "assigned_minutes": 120, "short_minutes": 0
  },
  "order": [ /* now_task와 같은 모양, 해야 할 순서대로 */ ],
  "free_minutes": 180,
  "start_by": "2026-11-10T20:00:00+09:00",
  "overdue": []
}
```

- `now_task`: **지금 할 일** ("지금은 물리를 하세요")
- `order`: 해야 할 순서. `short_minutes`가 0보다 크면 그만큼 시간이 부족하다
- `status`: `ok`(여유 30분 이상) · `tight`(여유 30분 미만) · `short`(시간이 모자란 일이 있음)
- `free_minutes`: 지금 딴짓해도 모든 일을 예상 시간만큼 할 수 있는 시간
- `start_by`: 이 시각까지만 시작하면 됨 (`short`이면 `null`)
- `overdue`: 마감이 지난 일

### 4. 고해성사: POST /plan/wasted

```json
{"wasted_minutes": 60, "done_task_ids": []}
```

- `impacts`: 딴짓 때문에 시간이 모자라게 된 일과 줄어든 시간(`lost_minutes`)
- `now_task_changed`: 지금 할 일이 바뀌었는지
- `plan`: 새 계획 (`/plan`과 같은 모양)

## 계산 규칙

1. 마감까지 쓸 수 있는 시간: 오늘 마감은 남은 시간 전부, 내일 이후는 오늘 남은 시간 + 하루 `daily_minutes`씩 (실제 남은 시간을 넘지 않음)
2. 마감이 빠른 순, 같으면 중요 표시 순으로 정렬. 맨 앞이 `now_task`
3. 앞선 일에 배정한 시간을 빼고 남는 만큼만 뒤의 일에 배정. 예상 시간보다 모자라면 `short_minutes`

`app/planner.py`가 이 계산만 담당하고 DB와 분리돼 있어서 `tests/test_planner.py`로 바로 검증할 수 있다.
