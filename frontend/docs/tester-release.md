# 통합 사용자 테스트 준비

## 포함 범위

최신 기능 위에 다미 UI를 선택적으로 적용한 `feat/dami-ui-integration`을 사용한다. 원격 main의 `2f1ced6`을 병합하여 단원·주제별 AI 분류 기준과 temperature 0 설정을 반영했다. 백엔드 파일은 main의 내용을 그대로 사용한다. 운영 서버에 해당 커밋이 배포됐는지는 health 응답만으로 확인할 수 없다.

원래 작업 폴더의 리뷰 변경 4개는 보존한다. 배포 안전성에 필요한 제목 매칭의 모호성 차단, 짧은 일시정지의 관측 연속성 해제, 창 간 피드백 직렬화와 관련 테스트를 이 브랜치에 별도로 반영한다. 세션 종료 시 로컬 중지와 영상 데이터 메모리 정리는 이미 통합 코드에 반영돼 있다. 오래된 리뷰 문서는 과거 상태를 기술하므로 이번 테스트 안내로 사용하지 않는다.

## 테스터 설치

1. 제공된 ZIP 전체를 고정 폴더에 압축 해제한다. ZIP의 `SHA256SUMS.txt`와 파일 해시를 확인한다. 기존 공개 Release 링크는 이전 시험판이다.
2. 동봉된 NSIS 설치 EXE를 실행한다. 현재 설치 파일에는 코드 서명이 없다. WebView2 설치가 필요하면 설치 프로그램이 안내한다.
3. Chrome의 `chrome://extensions`에서 개발자 모드를 켜고 ZIP의 `extension` 폴더를 압축해제된 확장 프로그램으로 로드한다. ID는 `ohajfkkemocajnjlbnogdmoominkejci`이다.
4. ZIP 폴더의 PowerShell에서 아래 명령으로 Native Host 등록 경로와 origin을 미리 확인한다. 소스 빌드용 Prepare 스크립트는 필요하지 않다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\extension\scripts\Configure-DownloadedHost.ps1
# 표시된 경로와 extension ID를 확인하고 등록에 동의한 뒤 실행한다.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\extension\scripts\Configure-DownloadedHost.ps1 -Register
```

등록은 현재 사용자의 HKCU 호스트 키 하나를 사용한다. 패키지 폴더를 옮기면 경로를 갱신해야 한다. 다른 확장 ID를 사용하는 경우 `-ExtensionId <ID>`를 명시한다. 해제는 `Unregister-NativeHost.ps1 -ManifestPath <패키지의 manifest 절대 경로>`로 미리 확인한 뒤 승인하여 `-Apply`를 붙인다.

5. 앱과 확장 팝업을 열어 연결을 확인한다. 앱의 로컬 활동 감지 동의, YouTube 관측 동의와 확장의 관측 스위치를 각각 직접 설정한다. AI 전송에 동의하면 작업명과 영상 제목·ID가 운영 API로 전송되며 실제 유료 AI 호출이 발생할 수 있다.
6. 한 줄 작업을 입력하고 집중을 시작한다. 동의 없이도 일반 집중 세션을 시작할 수 있다. 종료 후 관측이 중지되는지 확인한다.

## 배포 전 확인할 시나리오

- 깨끗한 Windows 사용자 환경에서 설치·실행·해제, 확장 로드와 Native Host 등록. 이번 개발 PC의 기존 등록을 재사용한 결과와 구분한다.
- 실제 YouTube에서 공부 영상·확실한 배경음악·관련 없는 영상, 영상/탭/창 변경, 완전 가림·최소화, 동의 철회. Shorts는 미분류다.
- 사용자 승인 후 실제 `/judge`의 ask/ignore, `/judge/feedback` 정정, 같은 영상 재질문 방지. health/CORS 성공은 AI 동작 검증을 대신하지 않는다.
- Windows에서 실제 관측 시간을 바탕으로 1·5·10분 개입과 전체화면 복원. 자동 테스트는 가상 시간을 사용한다. 숨긴 메인 WebView의 타이머 제한도 실환경에서 확인해야 한다.
- 궁극기 중 일시정지·종료·각 동의 철회, 무응답으로 피드백이 생성되지 않음, 재실행 후 이전 영상이 복원되지 않음.

WebView의 종료 로그 1412는 창 클래스에 열린 창이 남았다는 Windows 오류다. 기존 실행에서 이후 앱 재실행과 세션 동작은 가능했다. 현재 증거에서는 배포 차단 결함으로 확정되지 않았으며 설치판의 반복 종료·재실행을 확인해야 한다. [Microsoft 오류 코드 설명](https://learn.microsoft.com/en-us/windows/win32/debug/system-error-codes--1300-1699-)

NSIS 생성과 소스 테스트 결과는 PR 및 최종 작업 보고에 기록한다. 설치 파일 생성과 실제 설치 성공은 별도로 기록한다. 이번 작업은 PR 준비까지만 수행하며 main 병합·Release 게시·운영 배포를 진행하지 않는다.

## 이번 준비에서 확인한 결과

- React 129개, Chrome 확장 12개, Rust 앱 26개, Native Messaging 프로토콜 5개, main의 기존 AI 모의 응답 테스트 13개를 통과했다. 프로토콜 테스트 2개는 실제 Windows의 격리된 테스트 pipe를 사용하며 Chrome 영상 관측과 구분한다.
- React 운영 빌드와 cargo check, Windows release NSIS 생성 및 Native Host release 빌드를 통과했다. NSIS는 약 2.95 MiB이며 서명되지 않았다. 이번 준비에서는 설치 프로그램을 실행하지 않았다.
- 가상 시간 개입 테스트 하나가 5초 기본 실행 제한에 도달해 해당 테스트의 실행 제한만 20초로 조정했다. 이후 React 전체 129개를 다시 통과했다. 제품의 1·5·10분 기준은 유지한다.
- 운영 `/health`가 200과 `ok: true`를 반환했다. `http://tauri.localhost`의 `/sessions` 사전 요청이 200을 반환했고, 운영 OpenAPI에 `/sessions`, `/judge`, `/judge/feedback` 계약이 있다. 실제 유료 판단은 호출하지 않았다.
- 기존 Windows 세션·위젯 동기화 검증을 유지한다. 이번 변경 후 실제 Chrome 및 유료 AI 전체 흐름과 설치판 전체화면 전환은 미검증이다.
