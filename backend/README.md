# 바꿔도 돼? 백엔드

사용자가 적은 **지금 할 일 한 줄**을 기준으로, 보고 있는 유튜브 영상이 공부인지 딴짓인지 AI로 판단하고
안뇽이 개입 후 **공부로 돌아왔는지**를 기록·측정하는 FastAPI 서버. DB는 SQLite 파일 하나(`bakkwodo.db`)다.

> 2026-11-12 방향 변경: 할 일 목록·우선순위 계산은 핵심 기능에서 뺐다. 아래 `/tasks`, `/plan` 계열 API는
> 기존 앱 호환을 위해 남겨 두었고, 새 흐름은 **세션 → 영상 판단 → 정정 → 복귀 지표**다.

## 실행

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m pytest -q                # 테스트 31개 통과 확인
uvicorn app.main:app --reload      # http://127.0.0.1:8000/docs 에서 바로 호출해 볼 수 있다
```

시연 데이터: `python -m scripts.seed_demo demo-user`

### 자연어 등록 (기본: Claude API)

자연어 등록(`/tasks/parse`)은 기본으로 Claude API를 쓴다. 실행 전에 키를 넣는다.

```bash
export ANTHROPIC_API_KEY=발급받은_키      # Windows PowerShell: $env:ANTHROPIC_API_KEY="발급받은_키"
uvicorn app.main:app --reload
```

키가 없으면 `/tasks/parse`만 503을 돌려주고 나머지 API는 정상 동작한다.

키 없이 로컬에서만 시험하고 싶으면 Ollama도 쓸 수 있다 (선택):
`LLM_PROVIDER=ollama`로 두고 `ollama pull qwen2.5:7b` 후 실행.

환경변수
- `DB_PATH`: 기본 `bakkwodo.db`. Railway에서는 볼륨 경로(예: `/data/bakkwodo.db`)로 설정
- `CORS_ORIGINS`: 기본 `*`. 프론트 배포 후 그 주소로 바꾸기
- `ANTHROPIC_API_KEY`: 자연어 등록에 필요
- `LLM_MODEL`: 기본 `claude-haiku-5-5`
- `LLM_PROVIDER`: `anthropic`(기본) 또는 `ollama`
- `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_TIMEOUT`: `LLM_PROVIDER=ollama`일 때만 사용 (기본 `http://localhost:11434`, `qwen2.5:7b`, 120초)
- `JUDGE_MAX_PER_SESSION`: 세션 하나에서 AI 판단을 부를 수 있는 최대 횟수 (기본 120, 넘으면 429)
- `METRICS_TOKEN`: 지표 API(`/metrics`) 비밀번호. 비워두면 지표 API는 닫힌다. 팀만 알고, 프론트에 넣지 않는다

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
| POST | `/sessions` | 할 일 한 줄로 집중 세션 시작 (**새 핵심**) |
| GET | `/sessions/current` | 진행 중인 세션 (없으면 `null`) |
| POST | `/sessions/{id}/end` | 세션 종료 (`completed` / `stopped`) |
| POST | `/judge` | 영상 분류 → 냅둘지(`ignore`) "너 혹시 딴짓해?"(`ask`)일지 (**새 핵심**) |
| POST | `/judge/feedback` | "아니? 전혀~" 정정. 이 세션에서 이 영상은 냅둠 |
| POST | `/tasks/parse` | 자연어 목록 → 할 일 초안 (저장 안 함) |
| POST | `/tasks/batch` | 초안 여러 개를 한 번에 저장 |
| POST | `/tasks` | 일 하나 저장 |
| GET | `/tasks?include_done=true` | 내 일 목록 |
| GET / PATCH / DELETE | `/tasks/{id}` | 일 조회, 수정(완료 체크 포함), 삭제 |
| GET | `/plan?now=` | 지금 할 일과 순서 (**핵심**) |
| POST | `/plan/wasted` | 고해성사 |
| GET / PUT | `/settings` | 내일 이후 하루 사용 시간(기본 480분) |
| POST | `/events` | 프론트 행동 기록 (지표용) |
| GET | `/metrics?since=&until=` | 사용자 검증 지표 (팀 전용, `X-Metrics-Token`) |
| GET | `/metrics/events.csv` | 익명화한 원본 이벤트 CSV (팀 전용) |

## 새 흐름: 세션 → 영상 판단 → 정정

### 1. 세션 시작: POST /sessions

```json
{"task": "전자기 유도 공부"}
```

응답 `{"id": 7, "task": "전자기 유도 공부", "started_at": "...", "ended_at": null, "end_reason": null, "active": true}`.
진행 중인 세션이 있으면 자동으로 끝낸다(`replaced`). 끝낼 때는 `POST /sessions/7/end` 본문 `{"reason": "completed"}` 또는 `{"reason": "stopped"}`.

### 2. 영상 판단: POST /judge

확장이 **새 영상을 관측했을 때 한 번만** 부른다 (몇 초마다 부르지 않는다).

```json
{"session_id": 7, "title": "패러데이 법칙 10분 정리", "video_id": "abcdefghijk"}
```

응답:

```json
{"category": "study", "action": "ignore", "reason": "같은 과목 개념 설명", "source": "ai", "cached": false}
```

**프론트는 `action`만 보면 된다.**

- `action: "ignore"` → 냅둔다
  - `category: "study"`: 할 일과 관련된 영상
  - `category: "background"`: 확실한 배경음악·플레이리스트·백색소음·Study With Me 등
  - `category: "user_ok"`: 사용자가 "아니? 전혀~"로 정정한 영상
- `action: "ask"` → **"너 혹시 딴짓해?"** 를 띄운다
  - `category: "other"`: 애매한 것과 확실한 딴짓을 구분하지 않고 전부 여기 (뮤직비디오·무대처럼 보는 영상일 수도 있으면 여기)
- `cached: true`: 같은 세션에서 이미 판단한 영상이라 AI를 다시 부르지 않음
- 보내는 것은 **할 일 한 줄 + 영상 제목**뿐. URL·채널·계정은 보내지 않는다
- 서버는 **제목을 저장하지 않는다.** 영상 ID(없으면 제목)의 해시와 분류 결과만 저장한다
- 오류: `404` 세션 없음 · `409` 끝난 세션 · `429` 세션당 AI 호출 한도 초과 · `502` AI 응답 이상 · `503` API 키 없음
  → 오류일 때는 로컬 키워드 판단으로 대신하거나 개입하지 않는다

### 3. 정정: POST /judge/feedback

"너 혹시 딴짓해?"에서 **아니? 전혀~** 를 눌렀을 때.

```json
{"session_id": 7, "title": "아이유 콘서트 풀버전", "video_id": "abcdefghijk"}
```

응답 `{"category": "user_ok", "action": "ignore", ...}`. 이 세션에서 같은 영상은 계속 `ignore`로 돌려준다.
정정 횟수는 오탐 지표로 쓴다.

**동의 문구에 꼭 넣을 것:** "집중 세션 중 보고 있는 유튜브 영상 제목과 할 일 한 줄을 AI(Claude)에 보내 공부 관련인지 판단합니다. 제목은 저장하지 않습니다."

## 사용자 검증 지표

### 이벤트는 누가 남기나

서버가 자동으로 남기는 것: `session_started` / `session_ended`, `judge_requested`(AI/캐시) / `judge_failed` / `judge_corrected`, 그리고 기존 `parse_*`, `tasks_saved`, `task_done` / `task_undone`, `wasted`

**프론트가 `POST /events`로 보내야 하는 것** (`X-User-Id` 헤더 포함, 응답 204):

| type | 언제 보내나 | task_id | payload 예 |
| --- | --- | --- | --- |
| `app_open` | 앱(웹)을 처음 열었을 때, 세션당 1번 | - | `{"platform": "web"}` 또는 `"desktop"` |
| `plan_viewed` | 사용자가 계획 화면을 열었을 때 (1분 자동 갱신은 보내지 않음) | - | |
| `focus_started` | 작업 시작 | 필수 | |
| `focus_paused` / `focus_resumed` | 일시정지 / 재개 | 선택 | |
| `focus_ended` | 완료하지 않고 세션 종료 | 필수 | |
| `checkin_shown` | "딴짓하세요?" 말풍선이 떴을 때 | 선택 | `{"simulated": true}` |
| `checkin_answered` | 말풍선 응답 | 선택 | `{"answer": "confess" \| "studying" \| "rest" \| "later"}` |
| `manual_input_used` | AI 대신 직접 입력 폼으로 저장 | - | |
| `feedback_opened` | 피드백 링크 클릭 | - | |
| `distraction_detected` | 딴짓으로 판단돼 시간이 쌓이기 시작함 | - | `{"site": "youtube"}` |
| `intervention_shown` | 안뇽이 개입 | - | `{"stage": "face" \| "bubble" \| "mission", "variant": "애니메이션 이름"}` |
| `intervention_answered` | 개입에 대한 응답 | - | `{"answer": "yes" \| "not_distracted" \| "none"}` (none = 무응답) |
| `returned` | 공부로 돌아옴 | - | `{"seconds": 95}` (개입부터 복귀까지) |
| `widget_hidden` | 잠깐 숨기기 | - | `{"duration": "30m" \| "1h" \| "today"}` |

```json
POST /events
{"type": "focus_started", "task_id": 3}
```

목록에 없는 type은 422. payload는 500자 이하, 개인정보·창 제목·URL은 넣지 않는다. 이벤트 전송이 실패해도 화면 동작은 막지 않는다(실패 무시).

### 지표 보기

```bash
curl -H "X-Metrics-Token: $METRICS_TOKEN" "https://서버주소/metrics?since=2026-11-11T00:00:00"
curl -H "X-Metrics-Token: $METRICS_TOKEN" "https://서버주소/metrics/events.csv" -o events.csv
```

모든 비율은 `numerator`(분자), `denominator`(분모), `rate`를 함께 준다.

**새 핵심 지표는 `focus` 안에 있다.**

- `focus.funnel`: 접속 → 세션 시작 → 안뇽이 개입 → 공부로 복귀 단계별 사용자 수와 이탈률
- `focus.return_after_intervention`: 개입 후 10분 안에(다음 개입 전에) 복귀한 비율 (**개입 후 복귀율**)
- `focus.median_return_seconds`: 복귀까지 걸린 시간의 중앙값
- `focus.ignored`: 개입에 무응답한 비율 (**무시율**)
- `focus.false_positive`: 응답 중 "아니? 전혀~" 비율 (**오탐률**)
- `focus.by_variant`: 애니메이션별 개입 수와 복귀율 (어떤 반응이 잘 먹히는지 비교)
- `focus.hidden`: 잠깐 숨기기 사용 수 (30m / 1h / today)
- `focus.judge`: AI 호출 수, 캐시 재사용 수, 사용자 정정 수
- `focus.sessions`: 세션 시작 수, 종료 이유별 수

아래는 기존(할 일 기반) 지표다.

- `funnel`: 접속 → 할 일 저장 → 계획 확인 → 작업 시작 → 작업 완료 단계별 사용자 수, 이전 단계 대비 전환율과 **이탈률**
- `core_completion`: 접속한 사용자 중 작업 완료까지 간 비율 (**핵심 기능 완료율**)
- `tasks.done_on_time`: 마감이 지났거나 끝난 일 중 **마감 안에 완료**한 비율, `missed`(못 끝낸 일), `done_late`
- `focus_sessions`: 작업 시작 후 같은 작업을 **완료**했는지 / 완료 없이 **그만뒀는지**(6시간 안 기준)
- `recovery_after_confession`: 고해성사 후 30분 안에 다시 시작·재개·완료한 비율 (**복구 후 재개율**)
- `checkin`: 말풍선 표시 수, 응답 종류, 응답률
- `returning_users`: 서로 다른 날 2일 이상 활동한 사용자 비율 (**재방문**)
- `parse`: 자연어 등록 성공률, 직접 입력 사용 수

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
- `503`: AI 설정이 없음(예: anthropic인데 키 없음) → 직접 입력 폼으로
- `422`: AI가 문장을 이해하지 못했거나 AI 호출에 실패함 → 다시 입력하거나 직접 입력 폼으로

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
