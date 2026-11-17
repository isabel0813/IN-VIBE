import type { CharacterState } from "../session/model";

// 안뇽이 원본 일러스트 (배경 투명). 홈 화면과 위젯이 같은 그림을 쓴다.
const annyong = "/characters/annyong.png";
// 상태마다 같은 그림을 쓰고, 위젯에서는 움직임(widget.css)으로 상태를 구분한다.
// 표정별 그림이 생기면 여기만 바꾸면 된다.
export const characterArt: Record<CharacterState, string> = {
  idle: annyong,
  focus: annyong,
  suspect: annyong,
  checkin: annyong,
  recovery: annyong,
  complete: annyong,
};
export const annyongArt = annyong;
// Confirmed 10-minute intervention image.
export const ultimateArt = "/characters/ultimate.png";
export const characterCopy: Record<
  CharacterState,
  { label: string; line: string }
> = {
  idle: { label: "작업 대기", line: "안뇽. 할 일 하나만 골라 봐." },
  focus: { label: "집중 중", line: "가라 인간. 지금 정한 일부터 처리해라." },
  suspect: {
    label: "딴짓 의심",
    line: "흠... 우리 분명 공부하기로 하지 않았나?",
  },
  checkin: { label: "사용자 확인", line: "지금 뭐 하고 있나, 인간?" },
  recovery: {
    label: "작업 복귀",
    line: "놀랍게도 아직 안 망했다. 다시 시작하자.",
  },
  complete: { label: "작업 완료", line: "해냈군. 제법인데, 인간?" },
};
