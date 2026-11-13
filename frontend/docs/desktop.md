# Phase 2 · 안뇽이 Windows 데스크톱 위젯

Tauri 2의 `main`과 `widget`은 **서로 다른 OS 창**입니다. React 메인 화면과 FastAPI 계약을 유지하면서, Rust 프로세스가 집중 세션을 소유합니다. 웹 브라우저에서는 화면 안에 미리보기만 표시하며 OS 창을 숨기거나 제어하지 않습니다.

## 실행과 빌드

Windows에서는 Node.js 24, Rust의 MSVC 도구체인, Visual Studio C++ Desktop 빌드 도구, Windows SDK, WebView2가 필요합니다. [Tauri 공식 사전 준비 안내](https://v2.tauri.app/start/prerequisites/)를 참고하세요.

```powershell
cd frontend
npm.cmd ci
npm.cmd run desktop:dev
```

`desktop:dev`가 Vite와 Windows 앱을 함께 시작합니다. 이미 실행 중인 Vite가 있다면 종료한 뒤 실행하세요. 개발 서버는 5173 포트를 고정 사용합니다. 기존 웹 개발은 `npm.cmd run dev`로 그대로 실행합니다.

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run desktop:check
npm.cmd run desktop:test
# Windows 실행 파일만 생성
npm.cmd run desktop:build -- --debug --no-bundle
# 배포용 실행 파일과 NSIS 설치 프로그램 생성
npm.cmd run desktop:build
```

검증 환경에서는 Rust가 없어 `frontend/.tools/`에 공식 Rust 도구체인을 설치했습니다. `scripts/desktop.mjs`가 이 경로를 발견하면 해당 프로세스에서만 사용합니다. 다른 개발자는 일반 Rust 설치를 사용하면 됩니다. 도구체인과 빌드 결과는 Git에서 제외되며, 시스템 PATH는 변경하지 않습니다.

실행 파일은 `src-tauri/target/debug/in-vibe.exe` 또는 `src-tauri/target/release/in-vibe.exe`입니다. 설치 파일은 `src-tauri/target/release/bundle/nsis/`에 생성됩니다. 배포용 서명과 설치 프로그램 검증은 별도로 필요합니다.

FastAPI는 별도로 실행해야 합니다. 현재 API 기본 주소는 `http://127.0.0.1:8010`입니다. 데스크톱의 WebView 저장소는 Chrome의 저장소와 별개이므로 웹과 데스크톱의 사용자 UUID는 자동 공유되지 않습니다. 위젯은 Rust 세션에서 작업 정보를 읽고, 사용자가 이탈 시간을 확인했을 때 같은 origin의 UUID로 복구 API를 호출합니다.

다른 API 주소를 사용할 때는 `.env.local`의 `VITE_API_BASE_URL`과 `src-tauri/tauri.conf.json`의 `app.security.csp` 및 `devCsp` 내 `connect-src`를 함께 변경하세요. 기본 허용 주소는 `http://127.0.0.1:8010`과 `http://localhost:8010`입니다. 백엔드가 CORS origin을 제한한다면 개발 origin `http://127.0.0.1:5173`과 Windows 패키지 origin `http://tauri.localhost`를 허용해야 합니다.

## 실제 동작

- 작업 시작: 선택한 작업 ID·이름과 시작 시각을 세션에 저장 → 위젯을 표시 → 성공한 경우에만 메인 창을 숨깁니다. 창 제어가 실패하면 메인 창에서 오류를 확인하고 `위젯으로 돌아가기`로 재시도할 수 있습니다.
- 위젯: 80×80 논리 픽셀의 투명·무테·항상 위 창입니다. 처음에는 메인 창이 있는 모니터의 작업 영역 오른쪽 아래에 놓습니다. 사용자 배율에 따라 실제 픽셀 크기가 달라집니다.
- 드래그: 캐릭터를 5px 이상 움직이면 OS 드래그를 시작합니다. 드래그를 클릭으로 처리하지 않습니다.
- 말풍선: 클릭한 경우에만 최대 340×440 크기로 창을 확장합니다. 위·아래 및 좌·우 공간에 맞춰 캐릭터의 화면상 위치를 유지하면서 배치합니다. 음수 모니터 좌표와 DPI를 고려하고 작업 표시줄이 차지한 영역은 피합니다.
- 포커스: 평소 위젯은 `focusable: false`이고 표시만 할 때 `set_focus`를 호출하지 않습니다. 사용자가 말풍선을 열 때만 포커스를 받아 버튼과 Esc를 사용할 수 있습니다. Esc, 다른 앱으로 포커스 이동, 말풍선 외부 클릭으로 닫고 다시 포커스를 받지 않게 합니다.
- `계획 보기`와 `할 일 추가하기`: 메인 창을 표시·복원하고 해당 화면으로 이동합니다. 메인 창에서 작성 중인 입력 텍스트는 유지합니다.
- 일시정지: 같은 세션의 `paused`만 변경하며 시작 시각을 초기화하지 않습니다. 재개 버튼으로 이어갑니다.
- 세션 종료: 진행 상태와 선택 작업을 비웁니다. **할 일 자체를 완료 처리하지 않습니다.** 작업 완료 체크는 기존 FastAPI를 이용하며, 현재 집중 작업을 완료하면 캐릭터가 `complete`가 됩니다.
- 위젯 숨김·최소화: 먼저 메인 창을 표시해 복귀 경로를 확보합니다. 메인 창의 `안뇽이 표시`로 다시 띄울 수 있습니다. 트레이나 전역 단축키는 추가하지 않았습니다.
- 메인 창의 닫기 버튼: 앱 전체를 종료합니다. 위젯만 닫는 OS 요청은 메인 창 복귀로 처리합니다.
- 앱 재시작: 항상 `idle`, 진행 중 세션 없음으로 시작합니다. 디스크나 localStorage에 집중 세션을 저장하지 않습니다. 창만 새로고침한 경우에는 살아 있는 Rust 프로세스의 세션을 다시 읽습니다.

## 상태와 에셋

`idle`, `focus`, `suspect`, `checkin`, `recovery`, `complete`에 서로 다른 SVG 표정과 한국어 대사가 연결됩니다. 개발 실행에서만 메인 화면 아래의 **개발 전용 · 안뇽이 상태 테스트**가 나타납니다. 표정 변경 자체는 세션을 시작·완료하거나 말풍선을 자동으로 열지 않습니다.

개발 시뮬레이션 `checkin`의 세 가지 응답은 각각 `recovery`, `focus`, 일시정지로 전환하며 `simulated` 표시를 유지합니다. 시뮬레이션은 `/plan/wasted`를 호출하지 않습니다. 실제 Windows 관측에서 시작된 확인과 복구 흐름은 [Windows MVP 안내](windows-mvp.md)를 참고하세요.

이미지는 자체 제작한 파란 용 임시 SVG이며 인하대학교 마스코트 원본이 아닙니다.

- 교체할 이미지: `public/characters/{state}.svg`
- 이미지 경로와 대사 매핑: `src/widget/character.ts`
- 임시 에셋 생성 원본: `scripts/generate-character.mjs`
- 실행 파일 아이콘: `src-tauri/icons/icon.png`, `icon.ico`

## 상태 동기화 구조

`src-tauri/src/session.rs`의 `Session`이 실제 데스크톱 상태를 소유합니다. 작업 ID·이름, 시작 시각(epoch milliseconds), `running`, `paused`, `character`, 개발 시뮬레이션 표시, 증가하는 `revision`을 관리합니다. 모든 상태 변경은 Rust mutex 아래에서 처리한 뒤 두 창에 이벤트를 발행합니다.

`src/session/store.ts`는 이벤트를 먼저 구독하고 스냅샷을 읽어 초기 조회와 변경 이벤트 사이의 경쟁을 처리합니다. 오래된 revision은 무시하며, 요청 응답도 스냅샷으로 받아 같은 상태로 수렴합니다. 창 포커스 복귀 시 다시 동기화하고 언마운트 시 리스너를 해제합니다. 웹 모드는 동일한 전이를 메모리 reducer로 실행합니다.

`src/desktop/bridge.ts`가 Tauri IPC와 웹 미리보기를 분리합니다. `src-tauri/src/lib.rs`가 창 생성 설정을 이용한 표시·숨김·드래그·말풍선 배치와 포커스 처리를 담당합니다. 프론트엔드에 포괄적인 OS 권한을 주지 않고, 이벤트 구독과 제한된 앱 명령만 노출합니다.

## Phase 2 당시 검증 기록

아래는 Phase 2 완료 시점의 기록입니다. 이후 실제 감지·복구·GUI 검증 결과는 [Windows MVP 안내](windows-mvp.md)에 별도로 기록합니다.

| 항목                                         | 결과                                            |
| -------------------------------------------- | ----------------------------------------------- |
| 기존 React 기능 및 API 계약                  | 기존 테스트 포함 Vitest 통과                    |
| 상태 전이·두 클라이언트 동기화·역순 이벤트   | 자동 테스트 통과                                |
| 말풍선 클릭·Esc·외부 클릭·checkin 응답       | React 테스트 통과                               |
| 모니터 모서리·DPI·음수 좌표 계산             | Rust 테스트 통과                                |
| Windows Rust 코드                            | `cargo check`, `cargo test` 통과                |
| Windows 실행 파일                            | Tauri debug 빌드 성공                           |
| 실제 Windows 앱 실행                         | 프로세스 실행 및 `바꿔도 돼?` 메인 창 생성 확인 |
| 실제 작업 시작 후 메인 숨김·별도 위젯 표시   | 수동 조작 미검증                                |
| 실제 투명도·항상 위·포커스 유지·드래그       | 수동 조작 미검증                                |
| 실제 말풍선·메인 복귀·6개 상태·일시정지·종료 | 수동 조작 미검증                                |
| 실서버 FastAPI/Ollama 및 NSIS 설치           | 미검증                                          |

Computer Use가 실행 중인 메인 창을 발견했지만 앱 접근 승인 시간이 만료되어 화면 캡처와 입력 조작을 진행하지 못했습니다. 웹 미리보기와 모의 IPC 테스트를 Windows 위젯 수동 검증으로 간주하지 않았습니다.

수동 확인 순서: `desktop:dev`와 FastAPI 실행 → 작업 선택·시작 → 메인 숨김/작은 독립 창 확인 → 캐릭터 드래그 → 클릭/Esc/외부 클릭 → 계획·입력 화면 복귀 → 상태 테스트에서 6종 변경 → `checkin` 세 응답 → 일시정지·재개·종료 → 숨김·최소화 후 복원 → 앱 종료·재실행 시 세션 초기화 확인. 다른 배율과 보조 모니터에서도 위치·포커스를 확인하세요.

## 이후 확장

Windows 활성 창 감지, 동의, 오탐 정정, 계획 복구는 MVP에 추가되었습니다. 정식 캐릭터 적용, 배포 서명·설치 테스트, 여러 모니터·배율의 장시간 검증은 후속 작업입니다.
