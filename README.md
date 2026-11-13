# 뭐보뇽 (IN::VIBE)

> 너 혹시 딴짓해?

노트북으로 공부하는 학생이 유튜브로 딴짓을 하면, 캐릭터 **안뇽이**가 알아채고 말을 걸어 **다시 공부로 돌아오게** 하는 서비스.

- 사용자는 지금 할 일을 한 줄로 적고 집중 세션을 시작한다 (예: "전자기 유도 공부")
- 크롬 확장이 보고 있는 유튜브 영상 제목을 읽고, AI가 할 일 기준으로 분류한다
  - 공부 영상 · 확실한 배경음악 → 냅둔다
  - 그 외 (애매한 것 + 딴짓) → 안뇽이가 "너 혹시 딴짓해?"를 띄운다
- 잘못 판단했으면 "아니? 전혀~"로 정정하고, 그 영상은 그 세션 동안 다시 묻지 않는다
- 핵심 지표는 **안뇽이 개입 후 공부로 돌아온 비율**이다

## 폴더

- `backend/`: FastAPI + SQLite 서버. 실행 방법과 API 명세는 [backend/README.md](backend/README.md)
- `frontend/`: 웹 화면과 Windows 앱(안뇽이 위젯)
- `extension/`: 유튜브 영상 제목을 읽는 크롬 확장

## 주소

- 웹: https://mobonyong.com
- API: https://api.mobonyong.com

## 작업 규칙

- 백엔드는 `backend/`, 프론트·확장은 `frontend/`, `extension/`만 수정한다.
- push 전에 `git pull`을 먼저 한다.
- API를 바꾸면 `backend/README.md`도 함께 고친다.
