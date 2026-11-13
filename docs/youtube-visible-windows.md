# YouTube 표시 창 감지 개발 기록

개발 브랜치 `dev/youtube-visible-windows`, 기준 main `7261a2bb60ba0ee3eab19db792e315e05443229c`.

## 미분류 진단

기존 worker는 active + lastFocusedWindow와 window.focused를 함께 요구했고 Rust는 foreground가 Chrome일 때만 영상 관측을 인정했다. 따라서 옆에 표시된 비활성 Chrome은 코드상 항상 제외됐다. 제목은 watch-flexy 내부의 제한된 h1 경로에 의존했고 Windows 제목도 알림 개수 접두사/공백 차이에 취약했다. 이 조건들을 자동 fixture로 재현했다. 실제 11월 12일 미분류 사례의 단일 원인은 브라우저 미실행 상태에서 확정하지 않았다.

## 구현

- 확장은 각 창의 선택 탭을 조회한다. 포커스를 요구하지 않으며 최소화 창과 비활성 탭은 제외한다. 동시 조회는 최대 4개 창이다.
- nonce와 epoch로 출처·프레임·탭·URL·세대를 검사한 후 결과를 단일 snapshot으로 보낸다. 재생 중 영상만 포함하고 매 snapshot으로 이전 목록을 교체한다. 제목 400자, 프레임 8192바이트 제한을 유지한다.
- 호스트는 기존 observation과 새 snapshot을 허용한다. 새 확장에는 이번 소스로 빌드한 호스트와 앱이 필요하다. 현재 공개 Release의 호스트와 혼용하면 연결되지 않을 수 있다. 이번 작업에서 설치·등록·업데이트는 수행하지 않는다.
- Windows는 모니터 좌표, 창 표시·최소화·DWM cloaked 상태, 위쪽 창 사각형을 이용해 Chrome 노출 면적을 계산한다. 원래 창 면적의 25% 이상이 모니터에서 가려지지 않았을 때 후보로 인정한다. 음수 좌표와 여러 모니터를 처리한다. 포커스는 필요하지 않다.
- 이 판정은 창 사각형의 기하 추정이다. 영상 플레이어 픽셀을 확인하지 않으며 부분 가림, 투명/레이어 창, 특수 창 영역, 전체화면 제목, 동일 제목의 여러 Chrome 프로필은 정확도 제한이 있다. 같은 제목 영상이 비활성 탭에도 존재하면 창과 탭을 완벽히 연결하지 못할 수 있다.
- 여러 영상은 AI 판단 후보로 각각 전달하되 영상 ID로 중복 제거한다. 기존 로컬 시간 감지는 한 후보를 선택해 1초 구간을 이중 누적하지 않는다. 한 줄 AI 세션은 기존 로컬 개입을 중복 발생시키지 않는다.
- 현재 영상 ID에 일치하는 DOM 컨테이너에서 플레이어/제목을 읽는다. 일반 h1과 구조화된 name 메타데이터를 대체 경로로 지원한다. 메타데이터는 문서 제목과 일치해야 하며 SPA 전환 중 제목 불일치는 미분류다. Shorts는 미분류를 유지한다.
- AI 응답을 기다리는 동안에도 표시 목록을 샘플링한다. 숨김/일시정지/탭 변경 시 질문을 해제하고, 응답은 세션·영상별로 캐시해 재노출 때 사용한다. 실패한 판단은 자동 반복하지 않는다.
- 명확한 배경음악 키워드는 판단 요청 전에 제외하고 서버 category=background와 action=ignore는 개입하지 않는다. 키워드 판정은 제목 기반 추정이다.
- 피드백 실패 시 질문과 명시적 재시도를 유지한다. 응답이 늦게 와도 다른 영상 질문을 덮어쓰지 않으며 정정/닫기는 세션 내 영상별로 기억한다. 세션 시작 연속 클릭을 잠근다.

## 자동 검사와 미검증 범위

React/Vitest, Node 확장 테스트, Rust 기하·관측·프로토콜 단위 검사와 컴파일을 실행한다. Windows named pipe 실환경 통합 테스트는 이번에는 제외한다. 브라우저 실행·UI 자동화·확장 재설치·레지스트리 변경·운영 AI API 호출·공개 배포는 수행하지 않는다.

실환경에서 확인할 항목은 화면 분할 및 음수 좌표/DPI가 다른 듀얼 모니터, 완전/부분 가림·투명 창·가상 데스크톱, 일반 영상 DOM과 SPA 이동, 최소화·일시정지·다른 탭, 동시에 두 영상 재생, 무입력 재생, 포커스를 빼앗지 않는 개입, 정정 및 세션 종료다. 새 코드의 실제 감지 성공을 의미하는 결과는 아직 없다.

참고 문서
- https://developer.chrome.com/docs/extensions/reference/api/tabs
- https://developer.chrome.com/docs/extensions/reference/api/windows
- https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute

## 이번 자동 실행 결과

- React `npm run build` 성공.
- Vitest 69개 통과.
- 확장 Node 테스트 8개 통과.
- Rust 앱 단위 테스트 18개 통과.
- Native Protocol 단위 테스트 3개 통과. 실제 named pipe 통합 1개는 명시적으로 제외.
- 앱/Native Host cargo check 성공.
- Tauri Windows release EXE 빌드 성공 (`build --no-bundle -- --offline`). 이번에는 설치 프로그램을 생성하거나 실행하지 않음.

## 수정 파일

- `extension/observer.js`, `extension/worker.js`
- `extension/native-protocol/src/lib.rs`
- `extension/tests/protocol.test.js`, `extension/tests/worker.test.js`, `extension/tests/worker-multi.test.js`
- `frontend/src-tauri/Cargo.toml`, `frontend/src-tauri/src/browser.rs`, `frontend/src-tauri/src/lib.rs`, `frontend/src-tauri/src/visibility.rs`
- `frontend/src/api/client.ts`, `frontend/src/components/CloudSession.tsx`, `frontend/src/components/CloudSession.test.tsx`, `frontend/src/components/videoPolicy.ts`, `frontend/src/activity/BrowserControls.tsx`
- `docs/youtube-visible-windows.md`

Native Host release 빌드도 성공했다. 이번 개발 변경은 로컬 브랜치에만 보존하며 원격 push 및 main 병합은 수행하지 않는다.
