# Chrome 확장 0.3.2와 Windows Host

이번 ZIP의 개발용 확장 ID는 `ohajfkkemocajnjlbnogdmoominkejci`이며 `manifest.key`는 ID를 고정하는 공개키입니다. 웹 스토어 ID `nndjojfhmpbolfifcfdcpalcloanppod`와 다릅니다. 웹 스토어에 이 코드가 자동 게시되는 것은 아닙니다.

일반 설치·업데이트는 ZIP 최상단 README.md를 따르세요. Native Host 설치 기본 ID는 웹 스토어판입니다. 동봉 개발용 확장은 `Configure-DownloadedHost.ps1 -ExtensionId ohajfkkemocajnjlbnogdmoominkejci`로 미리 확인한 뒤, 승인 시에만 `-Register`를 붙입니다. 고정 사용자 경로로 복사한 뒤 등록하며 다운로드 폴더를 직접 등록하지 않습니다.

source build는 `Prepare-NativeHost.ps1 -ExtensionId <실제 ID>`로 준비합니다. 이 개발용 스크립트는 소스 폴더의 `.local`에 빌드 결과를 준비할 뿐 레지스트리를 바꾸지 않습니다. 일반 사용자는 ZIP의 빌드된 Host를 사용하세요.

권한은 YouTube host, nativeMessaging, storage로 제한합니다. 전체 방문 이력·키 입력·화면 캡처·영상 본문·자막·계정 정보를 읽지 않습니다. 로컬 동의와 집중 세션이 있어야 관측하며, AI 서버 전송은 별도 동의입니다. 개인 영상 정보는 확장 storage에 저장하지 않고 관측 스위치만 저장합니다. 같은 영상의 반복 질문 억제와 관측 상태는 세션 메모리에서 처리합니다.

프로토콜 version 1에서 heartbeat/clear/observation/snapshot을 사용합니다. 메시지 최대 8192바이트, 영상 최대 4개, 제목 최대 400자입니다. nonce·선택 탭·창 최소화·재생 상태·세대/순번·유효기간을 검사합니다. 구버전 Host는 같은 version 1이어도 snapshot을 지원하지 않을 수 있으므로 HOST-BUILD.json 및 SHA256이 일치하는 동봉 Host를 사용하세요.

`npm test --prefix extension`은 실제 Chrome 대신 합성 DOM/Chrome API 및 가짜 레지스트리를 사용합니다. 실제 Chrome 관측은 Windows 앱·확장·Host의 실행 경로와 동의를 확인하고 별도로 검증해야 합니다.
