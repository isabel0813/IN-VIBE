# 뭐보뇽 Windows 0.3.2 — 제한적 사용자 테스트

태그: v0.3.2-test-20261118. 실제 빌드 소스 전체 SHA는 동봉 SOURCE.json에 있습니다. 자동 업데이트가 아니라 새 GitHub Release ZIP을 받아 설치하는 방식입니다.

## 설치·업데이트

Windows 11 x64, Google Chrome 및 WebView2가 필요합니다. 기존 집중 세션을 종료하고 앱을 정상 종료한 뒤, 새 설치 EXE를 기존과 같은 경로·사용자로 실행하세요. 앱을 먼저 제거하거나 사용자 데이터 삭제를 선택하지 마세요. Tauri 식별자 io.invibe.annyong, 실행 파일 이름과 사용자 데이터 경로를 유지합니다. 실시간 세션·영상 메모리는 앱 재시작 후 자동 복원하지 않습니다. 최신 main의 AI 동의 설정은 기기에 유지되므로 유료 시험 승인이 없다면 직접 끄세요.

1. GitHub Release의 ZIP과 SHA256SUMS.txt를 받습니다. `Get-FileHash .\Mobonyong-Windows-v0.3.2-test-20261118.zip -Algorithm SHA256` 결과를 비교하세요.
2. ZIP 전체를 압축 해제하고 Mobonyong-Windows-0.3.2-Setup.exe를 실행합니다. 설치 EXE와 Host는 코드 서명되지 않았습니다. Windows의 알 수 없는 게시자·SmartScreen 경고가 표시될 수 있습니다. 공식 출처·SHA256을 확인하고 설치 여부를 직접 결정하세요. 보안 설정을 낮추거나 경고를 우회하지 마세요.
3. 확장을 아래 두 방식 중 하나로 설치합니다. 동시에 둘 다 켜서 관측하지 마세요.

| 방식 | 확장 ID | 설치 |
| --- | --- | --- |
| 동봉 개발용 | ohajfkkemocajnjlbnogdmoominkejci | chrome://extensions에서 개발자 모드 → 압축해제된 확장 프로그램 로드 → 이 ZIP의 extension 폴더. 기존 개발 확장의 소스 경로가 다른 경우 먼저 확인하세요. |
| 공식 웹 스토어 | nndjojfhmpbolfifcfdcpalcloanppod | https://chromewebstore.google.com/detail/nndjojfhmpbolfifcfdcpalcloanppod (게시 상태·코드 버전은 별도이며 동봉 소스와 같다고 보장하지 않습니다.) |

## Native Host 고정 경로 설치

등록 전에 아래 미리보기 명령을 실행하세요. 동봉 개발용 확장을 쓰는 경우 ID를 명시해야 합니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\extension\scripts\Configure-DownloadedHost.ps1 -ExtensionId ohajfkkemocajnjlbnogdmoominkejci
# 경로·origin·소스 해시를 확인하고 등록에 동의한 뒤:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\extension\scripts\Configure-DownloadedHost.ps1 -ExtensionId ohajfkkemocajnjlbnogdmoominkejci -Register
```

웹 스토어판은 ID 인수를 nndjojfhmpbolfifcfdcpalcloanppod로 바꿉니다. 인수 생략 시 기본값도 웹 스토어 ID입니다. origin은 한 개만 허용합니다.

Host 파일 속성에 버전이 없을 수 있으므로 HOST-BUILD.json과 SHA256으로 출처를 확인하세요. 미리보기는 파일·레지스트리를 변경하지 않습니다. `-Register`는 Host 해시를 HOST-BUILD.json과 비교한 후 `%LOCALAPPDATA%\Mobonyong\NativeHost\<버전>-<해시>-<확장ID>`에 복사하고 현재 사용자 HKCU의 io.invibe.annyong.youtube 한 키만 갱신합니다. ZIP/Downloads의 EXE를 직접 등록하지 않습니다. 기존 등록·manifest는 같은 고정 루트의 backups 폴더에 백업하며 기존 Host 파일과 앱 데이터는 삭제하지 않습니다. 충돌하는 대상 파일이 있으면 덮어쓰지 않고 중단합니다.

등록 후 확장을 다시 로드해 새 Host가 실행되게 하고 기존 YouTube 탭을 새로고침하세요. 이전 Host 프로세스는 자동으로 종료하지 않습니다. 연결이 바뀌지 않으면 Chrome을 직접 정상 종료·재시작하고 새 경로를 확인하세요. 와일드카드나 복수 origin을 추가하지 마세요. 구버전 Host는 heartbeat에는 응답해도 snapshot을 거부할 수 있으므로 연결됨 문구만으로 판단하지 마세요.

해제는 설치 출력의 manifest 경로를 사용합니다. 기본 미리보기 후 사용자 승인 시에만 -Apply를 붙입니다. EXE나 사용자 데이터는 이 명령으로 삭제하지 않습니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\extension\scripts\Unregister-NativeHost.ps1 -ManifestPath "<고정 경로의 io.invibe.annyong.youtube.json>"
```

롤백은 앱·확장을 멈춘 상태에서 backups의 previous-registration.json 및 registration.reg를 확인하고 담당자와 기존 등록 복원 여부를 결정하세요. 이전 파일은 보존돼 있습니다. 다른 설치의 등록을 임의로 삭제하거나 덮어쓰지 마세요.

## 사용 및 확인

앱에서 로컬 활동 감지 동의 → 설정 적용 → YouTube 로컬 관측 동의, 확장의 관측 스위치를 직접 켭니다. AI 동의 없이도 한 줄 세션 시작·종료와 로컬 관측을 확인할 수 있습니다. 한 줄 세션은 로컬 이탈 감지와 별개인 YouTube·AI 경로를 사용하므로 monitoring=false만으로 실패를 판단하지 마세요. 이번 버전은 상태 표시를 구분합니다.

AI 판단은 별도 동의 후 작업명·영상 제목을 서버의 Claude에 보내며 비용이 발생할 수 있습니다. 제목·ID는 운영 API로 전송됩니다. 개인정보처리방침: https://mobonyong.com/privacy.html. 화면 캡처와 키 입력은 수집하지 않습니다. 로그·오류 제보에 영상 제목·URL·기기 ID·API 키를 넣지 마세요.

관측 누적 1분·5분에 위젯 표시, 10분에 궁극기 경로가 있습니다. 자동으로 다른 앱의 포커스를 빼앗는 말풍선 대신 위젯을 클릭해 질문을 확인합니다. 관련 영상·배경음악은 AI의 ignore이면 개입하지 않습니다. 오탐은 '아니? 전혀~'로 정정합니다.

## 변경 및 제한

최신 main 056ee78 기준 UI(몸통 드래그, 밝은 말풍선, 위젯 내 작업 변경, 클릭식 쉬는 시간·자동 재개, 설정 뒤로가기)와 감지 상태 표시 수정을 포함합니다. 구버전 snapshot 미지원 Host를 최신 구현으로 교체했고 출처·해시 정보를 동봉합니다. main 병합이나 웹·백엔드 배포는 이 Release와 별개입니다.

실제 검증 범위는 VALIDATION.md를 확인하세요. 실제 유료 AI E2E, 1·5·10분 실영상 개입·궁극기 전체화면, 깨끗한 별도 PC·계정, 듀얼 모니터/DPI 및 공식 스토어판과의 전체 흐름은 검증 완료로 간주하지 않습니다. Shorts는 미분류입니다. WebView 종료 로그 1412는 이전 시험판에서 재발했으며 이번 결과도 검증 기록에 따로 적습니다. 프로토콜·모의 AI 테스트 통과가 실제 Chrome 영상 성공을 뜻하지 않습니다.
