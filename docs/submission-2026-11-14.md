# 뭐보뇽 제출 준비 기록 — 2026-11-14

## 제품 설명 초안

뭐보뇽은 공부할 일 한 줄로 집중 세션을 시작하고, YouTube 영상의 공부 관련성을 AI로 판단해 안뇽이가 사용자에게 확인하는 Windows 집중 도우미입니다. 사용자는 판단을 정정하고 다시 공부로 돌아갈 수 있습니다. 웹에서는 세션과 계획을 관리하며, YouTube 자동 관측에는 Windows 앱과 Chrome 확장을 함께 사용합니다.

## 실제 운영 검증

- https://mobonyong.com/ HTTP 200. 현재 공개 화면은 이전 이름 '바꿔도 돼?'이며 새 한 줄 세션 UI와 설치 안내는 배포 대기.
- https://api.mobonyong.com/health HTTP 200, {"ok":true}.
- 별도 테스트 UUID로 POST /sessions → POST /judge 1회 → POST /judge/feedback → POST /sessions/{id}/end 성공.
- 실제 AI 결과는 other / ask, 정정 결과는 user_ok / ignore, 종료 active=false.
- 웹 Origin과 http://tauri.localhost의 CORS preflight 모두 200.
- API 키는 클라이언트에 추가하지 않음. production 환경 파일은 공개 API URL만 포함.

## 이번 변경

기존 계획 UI에 한 줄 집중 세션을 추가. 새 세션은 /sessions를 사용하고 기존 계획 작업과 ID 영역을 구분. 기존 계획의 새로고침이 한 줄 세션을 종료하지 않도록 처리. 별도 AI 동의 후 실제 관측 중인 영상만 /judge에 전송. 세션/영상별 요청 1회로 제한하며 실패 시 자동 반복 중지. ask 질문과 ignore 처리, 사용자 정정 및 종료 연결. 네이티브 로컬 감지는 한 줄 AI 세션에서 중복 개입하지 않도록 처리. 재시작 시 세션과 AI 전송 동의 자동 재개 없음.

## 지원 제한과 제출 후 작업

- 최신 전체 Chrome → Native Host → 앱 → AI → 안뇽이 GUI 시나리오는 실제 검증 전까지 완료로 표시하지 않음.
- 이전 실행에서 호스트 등록과 확장 설치, 앱 연결은 확인했으나 실제 재생이 미분류로 남은 사례가 있음. 이번 작업에서 재설치/레지스트리 변경은 수행하지 않음.
- Shorts 미분류. 실제 foreground Chrome 한 창·선택 탭만 관측. 화면 분할·듀얼 모니터의 비활성 재생 관측은 후속 필수 개발 항목.
- 서명 없는 Windows 빌드. 다른 PC의 설치/제거, SmartScreen, WebView2 전제 조건 미검증.
- 기존 고해성사/계획 복구는 기존 계획 모드에서 유지. 한 줄 AI 세션의 '맞아' 버튼은 질문을 닫고 공부 복귀를 유도하며 경과 시간 기반 계획 복구를 자동 수행하지 않음.
- 앱 강제 종료 시 서버 세션 종료 호출은 보장되지 않음. 다음 새 서버 세션 시작이 이전 세션을 종료함.
- 확장 설치와 호스트 등록은 수동 동의가 필요함. 확장 설치 안내는 frontend/public/install.html과 extension/README.md.

## 공개 준비

웹 배포 산출물은 frontend/dist. Windows와 확장/Native Host 묶음은 .qa/submission 아래 준비하며 바이너리는 Git 제외. 승인 후 변경 커밋 push, 웹 배포, GitHub Releases ZIP 게시 및 공개 다운로드 링크 연결 필요. 현재 공개 다운로드 링크를 확보했다고 주장하지 않음.

## 2026-11-14 제출 준비 추가 검증

React 빌드 성공, Vitest 63개 성공(기존 60개 + 한 줄 세션/ask/정정/종료, ignore, AI 동의 없음 검사 3개), 확장 Node 테스트 5개 성공, cargo check 앱/호스트 성공, Rust 앱 15개 및 Native Protocol 3개 성공. 실제 named pipe 테스트는 샌드박스에서 권한 오류 5가 발생했으며 사용자 컨텍스트에서 재실행해 3개 모두 통과.

Windows release EXE와 NSIS 생성 성공. 샌드박스에서 NSIS DLL 오류 623이 발생해 사용자 컨텍스트로 재실행하여 해결. 새 EXE를 실제 실행해 한 줄 입력, 운영 세션 시작, 메인 숨김, 독립 위젯 표시, 위젯 말풍선의 실제 작업명, 위젯 종료와 메인 복귀를 확인. 활동 관측과 AI 동의는 꺼진 상태로 검사. 전체 실제 Chrome AI 경로, NSIS 설치/제거, 다른 PC 검증은 미완료.

공개 게시·push·웹 배포는 사용자 승인 전까지 보류. 설치 안내와 웹 ZIP, Windows/Chrome/Native Host ZIP을 로컬 준비. Windows 배포물은 코드 서명되지 않음.
