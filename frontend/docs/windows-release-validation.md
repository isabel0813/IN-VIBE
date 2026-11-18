# Windows 0.3.2 검증 기록 (2026-11-18)

소스는 최신 main `056ee78`을 기준으로 별도 배포 브랜치에서 구성했다. 정확한 전체 소스 SHA는 SOURCE.json과 Release 태그를 확인한다. 기존 원본 checkout의 리뷰 변경 4개 및 pipeline-diagnostics worktree의 미커밋 6개를 건드리지 않았다. main에는 병합하지 않고 Release 태그로만 게시한다.

## 자동 테스트와 빌드

| 항목 | 실제 결과 |
| --- | --- |
| React / Vitest | 139개 통과, 17개 테스트 파일 |
| Chrome 확장 | 16개 통과. 12개 관측·nonce·창/탭/재생/재연결 테스트 + 4개 설치 회귀 테스트 |
| Host 설치 스크립트 | 두 ID 미리보기, 무변경, 변조 EXE 거부, 고정 경로 복사·백업·재실행·충돌 방지 통과. 등록 시험은 가짜 PowerShell registry 함수만 사용해 실제 레지스트리를 바꾸지 않음 |
| Rust 앱 | 새 release 빌드에서 26개 통과 |
| Native Messaging 프로토콜 | 5개 통과. 2개는 격리된 실제 Windows named pipe 합성 왕복 |
| Host EXE 합성 시험 | 두 origin 각각 heartbeat·빈 snapshot, 잘못된 origin, 중복 순번, 과대 프레임 시험 통과 (2 × 4 = 8개). 실제 영상 정보는 보내지 않음 |
| React / TypeScript / Vite | 운영 API https://api.mobonyong.com 대상으로 빌드 통과 |
| cargo check | release 프로필 통과 |
| Windows Tauri NSIS | 0.3.2 x64 최종 빌드 통과. 새 다운로드 URL과 설치 HTML 포함 |
| Native Host | 0.3.2 release 빌드 통과. snapshot 지원. SHA256 A175499A4878F356E072123E92BFBD931F267C3260031948E5D311D5508B6E7C |
| 출처·비밀정보 | 변경 파일의 비밀키·토큰 패턴 후보 없음. env/사용자 데이터/도구체인/빌드 캐시는 ZIP과 커밋에서 제외 |

초기 설치 시험에서 Windows PowerShell의 Get-FileHash 자동 로드 실패가 발견돼 .NET SHA256 계산으로 보완했다. 가짜 registry의 상태 스코프도 수정했다. 수정 후 16개 확장 테스트 및 전체 React 테스트를 다시 통과했고 실패를 무시하지 않았다.

## 실제 Windows 설치·GUI

- 기존 설치판 0.3.0의 EXE와 제거 프로그램을 QA 폴더에 백업했다. 기존 경로에 최종 NSIS로 0.3.2 업데이트 설치하여 종료 코드 0을 확인했다. 설치 EXE와 Windows 설치 등록 버전 모두 0.3.2였다. 개발 target EXE 대신 이 설치 경로의 EXE를 실제 실행했다.
- 식별자 io.invibe.annyong, 제품명, 실행 파일 이름, 창/CSP 설정은 유지했다. 실제 데이터 경로 `%LOCALAPPDATA%\io.invibe.annyong\EBWebView`의 Local Storage LevelDB, Preferences, Secure Preferences, Local State 등 11개 파일을 설치 직전·직후(앱 실행 전) 비교해 모두 SHA256이 일치했다. 모든 설정 항목을 개별 조작한 시험은 아니다.
- 기존 Host 등록은 `...\Mobonyong\NativeHost\0.3.1-d3547d0`을 가리킨 상태로 유지했다. 이번 작업은 실제 등록·Chrome 확장·개인정보 동의를 대리로 변경하지 않았다. 새 설치 스크립트는 별도 사용자 실행·승인 후에만 등록을 갱신한다.
- 실제 설치판의 최신 홈, 메뉴, 설정 뒤로가기, 새 v0.3.2 Release 다운로드 링크를 확인했다. YouTube 연결됨과 'Windows 활동 감지 동의가 필요해요' 안내도 실제 화면에서 확인했다. 이후 사용자가 동의를 직접 변경하여 '집중 세션 시작 대기' 상태도 관찰했다.
- 사용자 입력이 감지돼 앱을 강제로 종료하지 않고 남겨 두었다. 이번 0.3.2의 정상 종료·재실행과 WebView 오류 1412 재현 여부는 미검증이다. 이전 버전에서는 1412 로그 후 종료 코드 0과 재실행이 확인된 적이 있지만 이번 버전의 결과로 대신하지 않는다.
- 운영 DB 변경 금지에 따라 집중 시작 버튼을 누르거나 /sessions, /judge, /judge/feedback을 실제 호출하지 않았다. 실제 위젯 세션·드래그·작업 변경·일시정지·영상 E2E는 이번 설치판에서 직접 수행하지 않았다. 관련 기능은 최신 소스 및 자동 테스트로 확인했다.

## 자동/모의 검증과 실환경 미검증의 구분

세션 중복 방지, 동의 철회, 늦은 판단 응답 차단, 오탐 정정과 동일 영상 반복 질문 억제, 창 간 메모리 동기화, 1·5·10분 단계, 배경음악/ignore 제외 및 휴식 자동 재개는 자동 테스트다. 실제 Chrome에서 새 ZIP 확장을 다시 로드하고 새 Host를 등록하여 영상을 관측한 것은 아니다.

실제 유료 AI E2E, 1·5·10분 실영상 개입, 궁극기 전체화면 전환·복원, 새 PC/계정, 공식 스토어 확장의 코드 동등성, 듀얼 모니터·DPI·가림 판정은 추가 확인이 필요하다. Shorts는 미분류다. 서명되지 않은 설치 EXE·Host와 이전 WebView 1412 로그는 알려진 제한으로 안내한다.

## 게시 방식

ZIP과 SHA256SUMS.txt만 새 시험판 Release에 첨부한다. 기존 Release·태그·자산을 삭제하거나 덮어쓰지 않는다. main/브랜치 push, Railway·Vercel 배포, 운영 DB 삭제·마이그레이션은 수행하지 않는다. 새 태그만 push하여 main의 웹·백엔드 자동 배포를 일으키는 경로를 피한다. 실제 업로드·다운로드 해시 검증 결과는 Release 게시 보고에 남긴다.
