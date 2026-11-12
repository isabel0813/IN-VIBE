# Phase 4 검증 기록 (2026-11-12)

이 기록은 자동 검증과 실제 Windows/Chrome 조작을 구분합니다. **Chrome 확장 설치·HKCU 등록·실제 영상 관측은 사용자 승인 대기이며, 전체 완료 시나리오를 통과한 것으로 표시하지 않습니다.**

## 자동 검사 및 실제 프로세스 검사

| 검사 | 결과 | 범위 |
|---|---|---|
| React 프로덕션 빌드 | 통과 | TypeScript 및 Vite |
| Vitest | 60개 통과 | 기존 58개 + 별도 YouTube 동의/연결 오류 표시 2개 |
| 확장 Node 테스트 | 5개 통과 | 출처/프레임/nonce/크기, SPA·Shorts·광고·재생 fixture, 선택 탭·창·최소화·해제의 mock Chrome API |
| Rust 앱 테스트 | 15개 통과 | 기존 감지/세션/위젯, 규칙 분류, 유휴 재생, stale generation, 타임아웃, 빠른 탭 전환, 영상 정정, 고해성사 중복 방지, 복귀 통계 |
| Rust 프로토콜 테스트 | 3개 통과 | 길이 제한, origin/schema, **실제 Windows named pipe 왕복·단일 서버·연결 해제** |
| cargo check | 통과 | 앱 및 별도 호스트 |
| Windows release / NSIS | 통과 | `src-tauri/target/release/in-vibe.exe`, `bundle/nsis/IN-VIBE_0.2.0_x64-setup.exe` |
| Native Messaging 호스트 EXE | 통과 | 실제 EXE stdin/stdout 프레임, 잘못된 origin, 과대 프레임, 중복 순번 거부, 종료 코드 |
| 호스트 EXE → 실행 중 Tauri | 통과 | 같은 사용자 named pipe의 heartbeat 응답 `connected: true`; 실제 영상 데이터는 보내지 않음 |
| 실제 FastAPI 8010 | 통과 | health/settings/tasks/batch/PATCH/plan/wasted. 새 테스트 UUID 사용 후 테스트 작업 삭제 |
| 경과 시간 중복 차감 방지 | 통과 | 같은 현재 시각의 `/plan`과 `/plan/wasted` 결과 계획 일치. 서버 시계 사용 확인 |
| 등록/해제 스크립트 | 미리보기 통과 | 실제 HKCU 쓰기/삭제는 하지 않음 |

처음 추가한 UI 테스트의 assertion을 이 프로젝트가 지원하는 Vitest 문법으로 수정한 후 60개 모두 통과했습니다. Tauri CLI의 offline 인수는 `node scripts/desktop.mjs build -- --offline`로 Cargo에 전달했습니다. Windows Store Python과 실제 앱의 사용자 전용 pipe는 샌드박스 밖에서 기존 설치를 사용해 검증했습니다. 시스템 Python/레지스트리/영구 실행 정책은 변경하지 않았습니다.

## 이번 실행에서 실제 GUI로 확인한 범위

- 새 Windows release EXE 실행, 기존 계획과 API 동기화.
- Windows 감지 기본 꺼짐, YouTube 별도 동의 기본 꺼짐, 동의 전 YouTube 체크박스 비활성화.
- YouTube 연결 안 됨/관측 중지와 로컬 통계 화면 표시.
- 독립 안뇽이 창 표시, 클릭으로 말풍선 열기, 현재 작업 대기 표시.
- 위젯의 계획 보기로 메인 화면 복귀 및 말풍선 닫힘.

## 아직 실제 Chrome에서 확인하지 못한 항목

다음은 코드/자동 테스트로만 검증했거나 수동 확인이 남아 있습니다. 현재 실행에서 실제 Chrome 시청 성공으로 간주하지 않습니다.

1. 확장 설치 후 실제 ID 확인, 승인된 HKCU 등록, Chrome → 호스트 → 앱 연결.
2. 일반 영상 제목/ID/재생 상태 및 YouTube 실제 DOM 호환성.
3. SPA 영상 이동, Shorts 미분류, 광고/버퍼링/일시정지.
4. 탭 전환·Chrome 최소화·다른 앱 전환·Chrome 종료 시 누적 중단.
5. 키보드 입력 없이 60초 이상 영상을 재생할 때 유휴 오분류가 없는지.
6. 실제 영상의 이탈 의심 → 작은 확인 말풍선 → 영상 ID 정정.
7. 실제 관측 → 고해성사 시간 확인 → API 복구 → 다음 공부 시작 전체 흐름.
8. 두 Chrome 창/프로필·연결 끊기·앱 재시작·세션 종료의 실제 Chrome 통합 동작.
9. 자동 개입 때 다른 프로그램의 키보드 포커스 유지.
10. NSIS를 이용한 설치/제거 및 다른 PC에서의 배포 확인.

설치와 수동 테스트 절차는 [extension/README](../../extension/README.md)를 따릅니다. 기본 300초, 개발 모드만 최소 10초입니다. 10초 테스트에서 API 기본 이탈 시간은 0분이며, 더 긴 측정 데이터로 꾸미지 않습니다. Shorts는 현재 안전하게 미분류 처리하는 범위까지만 지원합니다.

`backend/` 소스 변경 없음. `.env.local`, `.tools`, `.venv`, 실행 파일, Cargo target, 로컬 호스트 manifest는 Git에서 제외합니다. 앱과 백엔드는 검증을 위해 실행했으며, Windows/YouTube 관측 동의는 켜지 않았습니다.
