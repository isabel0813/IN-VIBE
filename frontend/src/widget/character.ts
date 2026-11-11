import type { CharacterState } from "../session/model";

// Replace these files (or URLs) to use the officially licensed character later.
export const characterArt: Record<CharacterState, string> = {
  idle: "/characters/idle.svg",
  focus: "/characters/focus.svg",
  suspect: "/characters/suspect.svg",
  checkin: "/characters/checkin.svg",
  recovery: "/characters/recovery.svg",
  complete: "/characters/complete.svg",
};
export const characterCopy: Record<
  CharacterState,
  { label: string; line: string }
> = {
  idle: { label: "작업 대기", line: "안뇽. 할 일 하나만 골라 봐." },
  focus: { label: "집중 중", line: "가라 인간. 오늘 마감부터 처리해라." },
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
