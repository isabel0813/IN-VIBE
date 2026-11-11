export const characterStates = [
  "idle",
  "focus",
  "suspect",
  "checkin",
  "recovery",
  "complete",
] as const;
export type CharacterState = (typeof characterStates)[number];
export interface FocusTask {
  id: number;
  name: string;
}
export interface FocusSession {
  revision: number;
  task: FocusTask | null;
  startedAt: number | null;
  running: boolean;
  paused: boolean;
  character: CharacterState;
  simulated: boolean;
}
export type CheckinChoice = "distracted" | "studying" | "break";
export type SessionAction =
  | { type: "start"; task: FocusTask }
  | { type: "pause" | "resume" | "end" }
  | { type: "complete"; task_id: number }
  | { type: "rename"; task: FocusTask }
  | { type: "character"; character: CharacterState }
  | { type: "checkin"; choice: CheckinChoice };

export function emptySession(): FocusSession {
  return {
    revision: 0,
    task: null,
    startedAt: null,
    running: false,
    paused: false,
    character: "idle",
    simulated: false,
  };
}

// Web preview reducer mirrors the Rust source of truth. No session is persisted.
export function reduceSession(
  session: FocusSession,
  action: SessionAction,
  now = Date.now(),
  development = import.meta.env.DEV,
): FocusSession {
  const next = { ...session, revision: session.revision + 1 };
  switch (action.type) {
    case "start":
      if (
        action.task.id <= 0 ||
        !action.task.name.trim() ||
        action.task.name.length > 100
      )
        throw new Error("유효한 작업을 선택해 주세요.");
      return {
        ...next,
        task: action.task,
        startedAt: now,
        running: true,
        paused: false,
        character: "focus",
        simulated: false,
      };
    case "end":
      return { ...emptySession(), revision: next.revision };
    case "pause":
    case "resume":
      if (!session.running) throw new Error("진행 중인 세션이 없어요.");
      return {
        ...next,
        paused: action.type === "pause",
        character: action.type === "pause" ? "idle" : "focus",
        simulated: false,
      };
    case "complete":
      return session.task?.id === action.task_id
        ? {
            ...next,
            running: false,
            paused: false,
            character: "complete",
            simulated: false,
          }
        : session;
    case "rename":
      return session.task?.id === action.task.id
        ? { ...next, task: action.task }
        : session;
    case "character":
      if (!development)
        throw new Error("상태 시뮬레이션은 개발 빌드 전용이에요.");
      return { ...next, character: action.character, simulated: true };
    case "checkin":
      if (!session.running) throw new Error("먼저 작업을 시작해 주세요.");
      if (session.character !== "checkin")
        throw new Error("확인 중인 상태가 아니에요.");
      return {
        ...next,
        paused: action.choice === "break",
        character:
          action.choice === "break"
            ? "idle"
            : action.choice === "distracted"
              ? "recovery"
              : "focus",
      };
  }
}
