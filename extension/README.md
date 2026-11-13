# 안뇽이 YouTube 연결 (Windows / Chrome MV3)

확장 프로그램은 기본 **꺼짐**입니다. 확장 팝업과 Windows 앱에서 각각 동의하고 집중 세션을 시작해야 영상 관측이 시작됩니다. 관측할 수 없으면 미분류이며 이탈 시간으로 계산하지 않습니다.

## 로컬 설치

1. `chrome://extensions`에서 개발자 모드를 켜고 **압축해제된 확장 프로그램 로드**로 이 `extension/` 폴더를 선택합니다. 다른 출처의 확장 프로그램은 설치하지 마세요.
2. 표시된 ID를 확인합니다. 저장소의 공개 `manifest.key`가 유지되면 ID는 `ohajfkkemocajnjlbnogdmoominkejci`입니다. 키는 서명 비밀키가 아니며 ID를 고정하기 위한 공개키입니다.
3. 저장소 루트 PowerShell에서 `./extension/scripts/Prepare-NativeHost.ps1`을 실행합니다. Rust/MSVC가 필요하며 기존 `frontend/.tools`를 우선 사용합니다. 호스트 EXE와 실제 ID 하나만 허용하는 manifest를 `.local/native-host/`에 만듭니다. **이 단계는 레지스트리를 변경하지 않습니다.**
4. `./extension/scripts/Register-NativeHost.ps1`로 변경할 HKCU 경로와 값을 확인한 뒤, 사용자가 승인하면 `./extension/scripts/Register-NativeHost.ps1 -Apply`를 실행합니다. 관리자 권한/HKLM 변경은 필요하지 않습니다.
5. Windows IN-VIBE 앱을 실행합니다. Windows 활동 감지를 켠 뒤 **YouTube 영상 정보의 로컬 관측에 동의합니다**를 선택합니다. Chrome 확장 팝업에서 관측을 켜고 양쪽 연결 상태를 확인합니다. 기존 YouTube 탭은 한 번 새로 고침해야 콘텐츠 스크립트가 설치됩니다.
6. 작업을 시작하고 일반 YouTube 영상을 재생합니다. 앱을 종료하거나 세션을 멈추면 관측이 중지됩니다. 앱 재시작 후 동의와 세션은 자동 복원되지 않습니다.

실제 Chrome ID가 다르면 `Prepare-NativeHost.ps1 -ExtensionId <Chrome에 표시된 ID>`로 manifest를 다시 만들고 등록을 미리 확인한 후 승인하여 갱신합니다. 와일드카드/복수 origin을 허용하지 않습니다. 등록된 디렉터리를 이동하면 다시 준비/등록해야 합니다. 확장을 끈 뒤 호스트를 갱신하면 실행 중 파일 잠금을 피할 수 있습니다.

해제: 확장 팝업에서 끄기 → `Unregister-NativeHost.ps1`로 대상 확인 → 사용자 승인 후 `Unregister-NativeHost.ps1 -Apply` → Chrome 확장 삭제. 스크립트는 다른 경로의 등록을 임의 삭제하지 않습니다.

Windows PowerShell의 기본 실행 정책 때문에 이 저장소의 스크립트 실행이 차단되면, 검토한 스크립트에 한해 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./extension/scripts/Prepare-NativeHost.ps1`처럼 해당 프로세스에서 실행할 수 있습니다. 시스템의 영구 실행 정책은 변경하지 않습니다. 등록/해제에도 동일한 형식을 사용하며 `-Apply`는 승인 후에만 붙입니다.

## 데이터와 제한

- `https://www.youtube.com/*`만 접근합니다. `tabs`, 방문 이력, 키 입력, 화면 캡처 권한은 없습니다. 영상 본문·자막·댓글·채널·계정 정보를 읽지 않습니다.
- 제목(최대 400자), 11자 영상 ID, 재생 여부만 전달합니다. 콘텐츠 스크립트는 Native Messaging에 직접 접근하지 않습니다. 서비스 워커가 최상위 프레임, 선택한 탭/창, URL, 일회성 nonce 및 형식을 검사합니다.
- Native Messaging은 길이가 제한된 JSON 프레임입니다. 보조 EXE가 같은 Windows 사용자와 SYSTEM만 접근 가능한 로컬 named pipe로 앱에 전달합니다. 공개 HTTP 포트가 없고 원격 pipe 연결은 거부합니다. 같은 사용자의 악성 프로그램까지 막는 보안 경계는 아닙니다.
- 앱은 실제 foreground 프로세스가 `chrome.exe`이고 창 제목이 관측한 영상 제목과 일치할 때만 반영합니다. 동일 제목을 재생하는 여러 Chrome 프로필/창은 구별에 한계가 있습니다. 앱 하나·Chrome 프로필 하나 사용을 권장합니다. 동시에 하나의 호스트 연결만 받으며 이중 집계하지 않습니다.
- 일시정지, 탐색/버퍼링, 광고, 비활성 탭/창, 최소화, 연결 해제, 오래된 관측값은 누적하지 않습니다. 최대 약 2.5초의 관측 유효기간 및 3.5초 연결 타임아웃이 있습니다. 명시적인 탭/창 변경은 즉시 무효화합니다.
- YouTube DOM이 바뀌거나 Shorts의 활성 플레이어를 확실하게 확인하지 못하면 미분류입니다. 현재 Shorts는 의도적으로 관측하지 않습니다. 모바일 YouTube, 다른 Chromium 브라우저, 전체 화면의 제목이 다른 경우는 지원 보장이 없습니다.
- 영상의 작업 관련성은 키워드 추정입니다. `Study With Me`/배경음악은 판단 불가입니다. 사용자 정정은 해당 세션의 영상 ID에만 반영됩니다. AI 호출은 없습니다.
- 원본 활동과 통계는 앱 메모리에서만 보유하고 앱 종료 시 지웁니다. 서버에는 기존 복구 API의 시간/이유만 전송하며 영상 제목/ID/프로세스는 보내지 않습니다. 통계는 확정적인 생산성 평가가 아닙니다.
- `/plan/wasted`는 `now - wasted_minutes`와 현재 계획을 비교합니다. 프론트엔드는 확인한 정수 분만 보내며 현재 시각을 앞으로 옮기거나 다시 차감하지 않습니다. 짧은 개발 테스트의 1분 미만 관측은 기본값 0분입니다.

## 개발 및 검증

```powershell
npm test --prefix extension
npm test --prefix frontend
npm run build --prefix frontend
cd frontend
node scripts/desktop.mjs check --offline
node scripts/desktop.mjs test --offline
node scripts/desktop.mjs test --offline -p annyong-native-protocol
node scripts/desktop.mjs host:check --offline
node scripts/desktop.mjs host:build --release --offline
npm run desktop:build
```

개발 앱의 활동 감지 기준을 10초로 설정하면 빠르게 확인할 수 있습니다. 배포 빌드는 300초 미만을 거부합니다. **자동 테스트는 실제 Chrome/Windows 통합 검증을 대체하지 않습니다.** 실제 실행 결과는 `frontend/docs/youtube-validation.md`에 구분하여 기록합니다.

수동 시나리오: `전자기 유도 공부` 작업 시작 → 무관한 게임 영상 재생 → 실제 관측 시간이 기준에 도달 → 안뇽이의 작은 확인 말풍선 → 클릭 → 고해성사 시간 확인 → 계획 복구 → 다음 작업. 같은 흐름에서 공부 영상 정정, 다른 영상으로 SPA 이동, Shorts, 일시정지, 다른 탭, 최소화, 다른 앱, 입력 없이 재생, 연결 끊기, 세션 종료, 앱 재시작도 확인합니다. 자동 알림은 창 포커스를 요청하지 않습니다.

## 교체 지점

- 규칙/AI 분류기: `frontend/src-tauri/src/browser.rs`의 `RelevanceClassifier`. 향후 AI 도입 시에도 로컬 처리·동의·호출 빈도 제한을 유지해야 합니다.
- 관측 프로토콜/프레이밍: `native-protocol/`, Chrome 출처 검증: `protocol.js`, 선택 탭/창 제어: `worker.js`.
- 기존 복구 UI/API: `frontend/src/activity/RecoveryFlow.tsx`, `frontend/src/api/`. `/plan/wasted`의 기존 시간 계산을 변경하지 않습니다.
- 서버나 DB 교체는 이 구현에 포함되지 않습니다. 클라우드 전송을 추가하려면 별도 설계와 명시적 동의가 필요합니다.

설계 참고: [Chrome Native Messaging 공식 문서](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [Chrome tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs).

## 2026-11-14 제출용 배포 묶음

제공받은 ZIP에는 미리 빌드한 `extension/native-host-runtime/in-vibe-native-host.exe`가 포함됩니다. Rust 설치 없이 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./extension/scripts/Configure-DownloadedHost.ps1`로 등록 내용을 확인하고, 동의하면 `-Register`를 붙여 사용자별 호스트를 등록합니다. ZIP 전체를 고정된 경로에 먼저 압축 해제하세요. 실제 확장 ID가 다르면 `-ExtensionId <ID>`를 지정하세요. 레지스트리 변경은 사용자가 이 단계를 명시적으로 실행할 때만 일어납니다.

새 한 줄 AI 세션은 별도 AI 동의 후 관측한 제목·ID를 `https://api.mobonyong.com/judge`로 보냅니다. 기존 계획 모드의 로컬 분류와 다릅니다. `ask`는 확인 질문을 표시하고 `ignore`는 개입하지 않습니다. “아니? 전혀~”는 `/judge/feedback`으로 해당 세션에서 정정합니다. 전체 제출 검증과 미확인 범위는 `docs/submission-2026-11-14.md`, 일반 사용자 안내는 `frontend/public/install.html`에 기록합니다.
