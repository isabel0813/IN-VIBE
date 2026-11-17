export type Video = { title: string; video_id: string };
import type { InterventionStage } from "./intervention";
export type CloudState = { id: number; task: string; ask: Video | null; reason: string; stage?: InterventionStage };
type Snapshot = { value: CloudState | null; dismissed: string[] };
type Message = { type: "reset" | "state" | "read" | "dismiss"; owner?: string; revision?: number; request?: string; snapshot?: Snapshot; session?: number; video?: string };
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
  function dismiss(session: number, video: string) {
    if (snapshot.value?.id !== session) return;
    const value = snapshot.value;
    snapshot = { value: value.ask?.video_id === video ? { ...value, ask: null, reason: "", stage: undefined } : value,
      dismissed: [...new Set([...snapshot.dismissed, video])] };
    revision++;
    publish();
    sendState();
  }
  function request(type: "read" | "dismiss", session?: number, video?: string) {
    if (owner) {
      if (type === "dismiss" && session !== undefined && video) dismiss(session, video);
      return Promise.resolve();
    }
    if (!port) return Promise.reject(new Error("메모리 동기화를 사용할 수 없어요. 메인 화면에서 확인해 주세요."));
    return new Promise<void>((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("메인 화면과 상태를 동기화하지 못했어요.")); }, 2000);
      pending.set(id, { resolve, timer });
      port.postMessage({ type, request: id, session, video });
    });
  }
  if (port) port.onmessage = ({ data }) => {
    if (!data || typeof data !== "object") return;
    if (owner) {
      if (data.type === "dismiss" && typeof data.session === "number" && typeof data.video === "string") dismiss(data.session, data.video);
      if (data.type === "read" || data.type === "dismiss") sendState(data.request);
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
    dismissed: () => snapshot.dismissed,
    set,
    dismiss: (session: number, video: string) => request("dismiss", session, video),
    refresh: () => request("read"),
    subscribe(callback: () => void) { listeners.add(callback); return () => { listeners.delete(callback); }; },
    reset() {
      if (!owner) return;
      snapshot = { value: null, dismissed: [] };
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
