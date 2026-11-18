# Railway 운영 DB 읽기 전용 사전 집계

이 문서는 백엔드 담당자가 운영 볼륨 `/data/mobonyong.db`에서 **집계만** 실행하기 위한 인수 안내다. 현재 자동 삭제 구현은 로컬 브랜치에 있으며 운영에 배포되지 않았다. 아래 단독 스크립트만 전달하므로 애플리케이션 배포·재시작·마이그레이션이 필요하지 않다.

## 기존 metrics API와 사전 집계의 역할

| 경로 또는 도구 | 제공하는 정보 | 권한 |
| --- | --- | --- |
| `GET https://api.mobonyong.com/metrics` | 이벤트·할 일에서 계산한 퍼널, 이용자 수, 세션·개입·복귀·오탐 정정·AI 호출 및 캐시 지표, 기존 할 일 관련 지표 | `X-Metrics-Token` |
| `GET https://api.mobonyong.com/metrics/events.csv` | 이벤트 시각·유형·가명 처리한 사용자 값·task_id·payload의 행 단위 CSV | `X-Metrics-Token` |
| `scripts/retention_report.py` | 4개 테이블의 실제 행 수, 생성 시각 만료, 세션 연쇄 삭제를 포함한 후보 수, 시각 오류·미종료 만료 세션 등 | DB를 읽을 수 있는 Railway 컨테이너 접속 권한 |

metrics의 세션 시작·AI 호출 수는 이벤트 기반 지표다. 세션 테이블의 현재 행 수·영상 판단 캐시 행 수·30일 만료 후보를 얻으려면 아래 DB 집계를 사용한다. `since`/`until` 이벤트 기간 조회에도 연결된 영상 판단의 연쇄 삭제 계산은 포함되지 않는다.

이번 집계에는 metrics 토큰이 필요하지 않다. 토큰을 코드·명령 인자·채팅·일반 로그에 넣거나 환경변수 전체를 출력하지 않는다. 회신은 아래 집계 JSON으로 진행하며 이벤트 CSV·행 원문을 첨부할 필요가 없다.

## 전달할 파일과 동작

로컬 `backend/scripts/retention_report.py` 파일 하나를 담당자에게 전달한다. 이 파일은 Python 표준 라이브러리만 사용하며 `app`·`db.connect`·FastAPI를 import하지 않는다. 현재 운영 체크아웃에 이 파일이 없어도 stdin으로 실행할 수 있다.

- 기존 파일만 `mode=ro`로 열고 `PRAGMA query_only=ON`과 읽기 트랜잭션을 사용한다.
- 생성 시각은 UTC로 비교하며 시간대 없는 기존 값은 한국 시간으로 해석한다.
- DB·스키마·설정·백업을 생성하거나 삭제하지 않는다. `settings`는 자동 삭제 집계에서 제외한다.
- 여러 테이블의 수치는 같은 읽기 스냅샷에서 집계한다. 읽기 잠금이 쓰기에 영향을 줄 수 있으므로 낮은 트래픽 시간에 실행한다.
- 라이브 DB의 WAL을 반영하도록 일반 SQLite 읽기를 사용한다. `immutable=1`·`nolock=1`을 붙이거나 WAL 파일을 지우지 않는다.

## 담당자 실행 순서

1. Railway의 백엔드 서비스, 운영 환경, `/data` 볼륨이 연결된 실행 인스턴스를 확인한다. 기존의 승인된 Railway CLI·SSH 인증을 사용한다. Dashboard의 **Copy SSH Command**도 이용할 수 있다.
2. 담당자 PC에서 파일이 있는 디렉터리로 이동한다. 아래 프로젝트·서비스 식별자를 실제 값으로 바꾸고 운영 환경 이름을 확인한다.
3. 아래 명령 중 담당자 셸에 맞는 하나를 실행한다. 스크립트 본문을 원격 Python의 stdin으로 보내므로 운영 애플리케이션 파일을 교체하지 않는다.

PowerShell 예시

```powershell
Set-Location '<전달받은 retention_report.py가 있는 폴더>'
$retentionProjectId = '<실제 Railway 프로젝트 ID>'
$retentionServiceId = '<실제 백엔드 서비스 ID>'
Get-Content -Raw -Encoding UTF8 .\retention_report.py |
  railway ssh --project $retentionProjectId --service $retentionServiceId --environment production -- python - --db /data/mobonyong.db
$LASTEXITCODE
```

Bash 예시

```bash
cd '<전달받은 retention_report.py가 있는 폴더>'
RETENTION_PROJECT_ID='<실제 Railway 프로젝트 ID>'
RETENTION_SERVICE_ID='<실제 백엔드 서비스 ID>'
railway ssh --project "$RETENTION_PROJECT_ID" --service "$RETENTION_SERVICE_ID" --environment production -- python - --db /data/mobonyong.db < ./retention_report.py
echo $?
```

`railway ssh`는 배포된 서비스 컨테이너에서 명령을 실행하고 파이프 입력을 지원한다. `railway run`은 서비스 환경변수를 주입한 로컬 실행이므로 위 절차에서는 `railway ssh`를 사용한다. SSH 키 등록 등 첫 접속 인증은 담당자가 공식 안내에 따라 직접 완료한다. [Railway SSH 문서](https://docs.railway.com/cli/ssh), [Railway run 문서](https://docs.railway.com/cli/run)

Railway 컨테이너에 파일을 별도로 전달해 둔 경우에는 그 컨테이너 셸에서 다음 명령을 사용할 수도 있다.

```bash
python /tmp/retention_report.py --db /data/mobonyong.db
```

파일이 없거나 읽기 권한·잠금 오류가 발생하면 오류와 발생 단계만 회신한다. 이 단계에서 서비스 재시작, 권한 변경, 스키마 변경, `RETENTION_MODE` 변경, 삭제 명령을 실행하지 않는다. CLI 버전이 파이프 원격 실행을 지원하지 않으면 담당자의 기존 원격 셸에서 동일 파일을 실행한다.

## 회신할 집계

JSON 전체를 회신하면 다음 항목이 포함된다. 원문 사용자 ID·할 일·영상 제목·이벤트 payload는 출력하지 않는다.

| 항목 | 의미 |
| --- | --- |
| `database`, `snapshot_at_utc`, `cutoff_utc` | 실제 파일 경로와 집계 기준 시각, 기준 시각에서 30일 전 |
| `complete` | 필수 테이블·열이 있어 후보 수 계산을 완료했는지 여부 |
| 각 테이블의 `total` | 전체 행 수 |
| `expired_by_age` | 자기 생성 시각이 `cutoff_utc` 이하인 행 수. 정확히 30일인 경계도 포함 |
| `cascade_only` | 자기 생성 시각만으로는 만료되지 않았지만 만료 세션 삭제에 연결되어 추가 삭제될 영상 판단 수 |
| `delete_candidates_total` | 자기 만료와 세션 연쇄 삭제의 중복을 제거한 합계 |
| `invalid_dates` | 생성 시각을 해석할 수 없는 행 수. 별도 검토 필요 |
| 세션의 `active_delete_candidates` | `ended_at`이 비어 있는 만료 세션 수. 실제 사용자가 지금 집중 중인지와는 별도로 해석 |
| 영상 판단의 `orphaned_records` | 부모 세션을 찾을 수 없는 기존 판단 수 |
| `excluded_tables` | `settings` 자동 삭제 제외 확인 |

담당자가 표로 회신하려면 아래 형식을 사용한다. 값은 실제 JSON에서 옮기고 미확인은 `미확인`으로 남긴다.

| 테이블 | 전체 | 생성일 만료 | 연쇄 추가 | 중복 제거 후보 합계 | 시각 오류 |
| --- | --- | --- | --- | --- | --- |
| tasks |  |  | 0 |  |  |
| sessions |  |  | 0 |  |  |
| video_judgments |  |  |  |  |  |
| events |  |  | 0 |  |  |

추가로 기준 시각·cutoff, `complete`, 미종료 만료 세션과 고아 영상 판단 건수를 전달한다. `complete=false` 또는 `null`은 조회 불가를 뜻한다. 시각 오류가 있는 경우도 수치를 그대로 보고하고 삭제 가능 여부를 별도 검토한다. 정상 완료 종료 코드는 0, 스키마가 불완전하면 JSON을 출력하고 2를 반환한다.

집계 결과를 받은 다음 삭제 영향과 방침을 최종 점검한다. 운영 DB 삭제·마이그레이션·배포·방침 최종 게시는 이후 별도 승인 범위다. 이 읽기 전용 보고서는 기존 CLI의 삭제 승인 계획을 대신하지 않으며, 현재 시점의 삭제 대상 산정 결과를 제공한다.
