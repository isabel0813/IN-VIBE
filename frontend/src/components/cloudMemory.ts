export type Video = { title: string; video_id: string };
import type { InterventionStage } from "./intervention";
import { createDialogueSelector, isDialogueRequest, type DialogueRequest, type DialogueSelection } from "./dialogue";
export type CloudState = { id: number; task: string; ask: Video | null; reason: string; stage?: InterventionStage; dialogueId?: string };
export type ResponseMode = "return" | "study";
export type VideoResponse = { video: string; mode: ResponseMode; at: number };
type Snapshot = { value: CloudState | null; dismissed: VideoResponse[] };
type Message = { type: "reset" | "state" | "read" | "dismiss" | "change" | "changed" | "dialogue" | "dialogue-selected"; owner?: string; revision?: number; request?: string; snapshot?: Snapshot; session?: number; video?: string; mode?: ResponseMode; task?: string; error?: string; dialogue?: DialogueRequest; selection?: DialogueSelection };
type ChangeHandler = (task: string) => Promise<boolean>;
export interface MemoryPort {
  postMessage(message: Message): void;
  onmessage: ((event: MessageEvent<Message>) => unknown) | null;
}

// Only the main view owns state. Other views request current state or dismiss
// an ID. Nothing in this store is written to disk or restored after restart.
export function createCloudMemory(owner: boolean, port?: MemoryPort) {
  const identity = crypto.randomUUID();
  let authority: string | null = owner ? identity : null;
  let revision = 0;
  let snapshot: Snapshot = { value: null, dismissed: [] };
  const listeners = new Set<() => void>();
  const pending = new Map<string, { resolve: () => void; timer: ReturnType<typeof setTimeout> }>();
  // 위젯의 "할 일 바꾸기" 입력은 메인 화면의 컨트롤러가 처리한다.
  let changeHandler: ChangeHandler | null = null;
  const changes = new Map<string, { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let selectDialogue = createDialogueSelector();
  const pendingDialogue = new Map<string, (selection: DialogueSelection) => void>();
  function dialogue(event: DialogueRequest): DialogueSelection | Promise<DialogueSelection> {
    if (owner || !port) return selectDialogue(event);
    return new Promise(resolve => {
      const request = crypto.randomUUID();
      const finish = (selection: DialogueSelection) => {
        clearTimeout(timer);
        pendingDialogue.delete(request);
        resolve(selection);
      };
      const timer = setTimeout(() => finish(selectDialogue(event)), 600);
      pendingDialogue.set(request, finish);
      try { port.postMessage({ type: "dialogue", request, dialogue: event }); }
      catch { finish(selectDialogue(event)); }
    });
  }
  async function runChange(task: string) {
    if (!changeHandler) throw new Error("메인 화면이 준비되지 않았어요.");
    if (!(await changeHandler(task))) throw new Error("할 일을 바꾸지 못했어요.");
  }
  function requestChange(task: string) {
    if (owner) return runChange(task);
    if (!port) return Promise.reject(new Error("메모리 동기화를 사용할 수 없어요. 메인 화면에서 확인해 주세요."));
    return new Promise<void>((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { changes.delete(id); reject(new Error("메인 화면과 연결하지 못했어요.")); }, 15000);
      changes.set(id, { resolve, reject, timer });
      port.postMessage({ type: "change", request: id, task });
    });
  }
  const publish = () => listeners.forEach(callback => callback());
  function sendState(request?: string, reset = false) {
    port?.postMessage({ type: reset ? "reset" : "state", owner: identity, revision, snapshot, request });
  }
  function set(value: CloudState | null) {
    if (!owner) throw new Error("집중 상태는 메인 화면에서 변경해 주세요.");
    snapshot = { value, dismissed: value?.id === snapshot.value?.id ? snapshot.dismissed : [] };
    revision++;
    publish();
    sendState();
  }
  function dismiss(session: number, video: string, mode: ResponseMode) {
    if (snapshot.value?.id !== session) return;
    const value = snapshot.value;
    if (value.ask?.video_id !== video && mode !== "study") return;
    snapshot = { value: value.ask?.video_id === video ? { ...value, ask: null, reason: "", stage: undefined, dialogueId: undefined } : value,
      dismissed: [...snapshot.dismissed.filter(item => item.video !== video), { video, mode, at: Date.now() }] };
    revision++;
    publish();
    sendState();
  }
  function request(type: "read" | "dismiss", session?: number, video?: string, mode: ResponseMode = "return") {
    if (owner) {
      if (type === "dismiss" && session !== undefined && video) dismiss(session, video, mode);
      return Promise.resolve();
    }
    if (!port) return Promise.reject(new Error("메모리 동기화를 사용할 수 없어요. 메인 화면에서 확인해 주세요."));
    return new Promise<void>((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("메인 화면과 상태를 동기화하지 못했어요.")); }, 2000);
      pending.set(id, { resolve, timer });
      port.postMessage({ type, request: id, session, video, mode });
    });
  }
  if (port) port.onmessage = ({ data }) => {
    if (!data || typeof data !== "object") return;
    if (owner) {
      if (data.type === "dialogue" && data.request && isDialogueRequest(data.dialogue)) {
        port.postMessage({ type: "dialogue-selected", owner: identity, request: data.request, selection: selectDialogue(data.dialogue) });
        return;
      }
      if (data.type === "change" && typeof data.task === "string" && data.request) {
        const request = data.request;
        void runChange(data.task).then(
          () => port?.postMessage({ type: "changed", request }),
          (e: unknown) => port?.postMessage({ type: "changed", request, error: e instanceof Error ? e.message : String(e) }));
        return;
      }
      if (data.type === "dismiss" && typeof data.session === "number" && typeof data.video === "string") dismiss(data.session, data.video, data.mode === "study" ? "study" : "return");
      if (data.type === "read" || data.type === "dismiss") sendState(data.request);
      return;
    }
    const selection = data.selection;
    if (data.type === "dialogue-selected" && data.request && typeof selection?.template === "string" &&
        (selection.stage === 1 || selection.stage === 2 || selection.stage === 3)) {
      if (!authority || authority === data.owner) pendingDialogue.get(data.request)?.(selection);
      return;
    }
    if (data.type === "changed" && data.request) {
      const waiting = changes.get(data.request);
      if (!waiting) return;
      clearTimeout(waiting.timer); changes.delete(data.request);
      if (data.error) waiting.reject(new Error(data.error)); else waiting.resolve();
      return;
    }
    if ((data.type !== "state" && data.type !== "reset") || !data.snapshot || !data.owner || data.revision === undefined) return;
    if (data.type === "reset" || authority === null) { authority = data.owner; revision = -1; }
    if (authority !== data.owner || data.revision < revision) return;
    revision = data.revision;
    snapshot = data.snapshot;
    publish();
    if (data.request) {
      const waiting = pending.get(data.request);
      if (waiting) { clearTimeout(waiting.timer); pending.delete(data.request); waiting.resolve(); }
    }
  };
  return {
    read: () => snapshot.value,
    dismissed: () => snapshot.dismissed.map(item => item.video),
    responses: () => snapshot.dismissed,
    set,
    dialogue,
    dismiss: (session: number, video: string, mode?: ResponseMode) => request("dismiss", session, video, mode),
    refresh: () => request("read"),
    change: requestChange,
    /** 메인 화면 컨트롤러만 등록한다. 해제 함수를 돌려준다. */
    handleChange(handler: ChangeHandler) {
      if (!owner) return () => {};
      changeHandler = handler;
      return () => { if (changeHandler === handler) changeHandler = null; };
    },
    subscribe(callback: () => void) { listeners.add(callback); return () => { listeners.delete(callback); }; },
    reset() {
      if (!owner) return;
      snapshot = { value: null, dismissed: [] };
      selectDialogue = createDialogueSelector();
      revision++;
      publish();
      sendState(undefined, true);
    },
  };
}

const widget = new URLSearchParams(location.search).get("window") === "widget";
const port = typeof window.BroadcastChannel === "function"
  ? new window.BroadcastChannel("mobonyong.cloud-memory.v1") : undefined;
export const cloudMemory = createCloudMemory(!widget, port);
// Late widget creation requests a snapshot. Startup state also arrives when the
// main controller announces its reset, including after an app restart.
if (widget) void cloudMemory.refresh().catch(() => {});
export function removeLegacyCloudData() {
  // Remove only the two obsolete activity keys. Keep user identity/settings.
  let removed = true;
  for (const key of ["mobonyong.cloud-session", "mobonyong.cloud-session.dismissed"]) {
    try { localStorage.removeItem(key); } catch { removed = false; }
  }
  return removed;
}
if (import.meta.hot) import.meta.hot.dispose(() => { cloudMemory.reset(); port?.close(); });
