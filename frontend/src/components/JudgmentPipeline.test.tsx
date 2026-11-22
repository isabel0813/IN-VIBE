import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Incident } from "../activity/bridge";
vi.mock("./intervention", async original => ({
  ...await original<typeof import("./intervention")>(),
  escalation: { firstMs: 0, secondMs: 300_000, ultimateMs: 600_000 },
}));
const mocks = vi.hoisted(() => ({
  session: { running: false, paused: false, task: null as null | { id: number; name: string }, character: "idle", simulated: false },
  invoke: vi.fn(), show: vi.fn(), send: vi.fn(),
  native: { consent: true, collecting: true },
  incident: null as Incident | null,
}));
vi.mock("../desktop/bridge", async importOriginal => ({
  ...await importOriginal<typeof import("../desktop/bridge")>(),
  isDesktop: () => true, showWidget: mocks.show,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (command: string) => command === "browser_read"
  ? Promise.resolve(mocks.native) : mocks.invoke(command), isTauri: () => false }));
vi.mock("../session/store", () => ({
  useFocusSession: () => ({ session: mocks.session, ready: true, error: "" }),
  sessionStore: { send: mocks.send },
}));
vi.mock("../activity/bridge", () => ({
  useActivity: () => ({ activity: { consent: true, incident: mocks.incident } }), activityApi: {},
}));
import CloudSession from "./CloudSession";
import Widget from "../widget/Widget";
import { cloudMemory } from "./cloudMemory";

const key = "mobonyong.cloud-session";
const game = { title: "합성 게임 플레이", videoId: "abcdefghijk" };
let requests: { path: string; body: Record<string, unknown>; at: number; signal?: AbortSignal | null }[];
let respond: (path: string) => Promise<Response>;
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  requests = [];
  mocks.native = { consent: true, collecting: true };
  mocks.incident = null;
  mocks.session = { running: false, paused: false, task: null, character: "idle", simulated: false };
  mocks.send.mockImplementation(async action => {
    mocks.session = { ...mocks.session, running: action.type === "start", paused: false,
      task: action.task ?? null, character: action.type === "start" ? "focus" : "idle" };
  });
  mocks.invoke.mockResolvedValue([game]);
  mocks.show.mockResolvedValue(undefined);
  respond = async path => Response.json(path === "/sessions" ? { id: 23, task: "전자기 유도 공부" } : { action: "ask", category: "other", reason: "합성 판단" });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    requests.push({ path, body: JSON.parse(String(init.body)), at: Date.now(), signal: init.signal });
    return respond(path);
  }));
  // No request reaches a real server.
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const sample = () => advance(1000);
const judging = () => requests.filter(request => request.path === "/judge");
async function start(widget = false) {
  const view = render(<><CloudSession />{widget && <Widget native={false} />}</>);
  fireEvent.change(screen.getByLabelText("지금 공부할 일"), { target: { value: "전자기 유도 공부" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "집중 시작" }));
  await waitFor(() => expect(mocks.show).toHaveBeenCalledWith(true));
  await sample();
  return view;
}

describe("synthetic judgment pipeline", () => {
  it("shows only the YouTube question when an inactivity incident reaches the widget concurrently", async () => {
    mocks.incident = { id: 42, kind: "inactivity", stage: 1, startedAt: 0, seconds: 60, process: "", title: "", claimed: false };
    await start(true);
    await sample();
    expect(screen.queryByText("혹시 딴짓 중이야?")).toBeNull();
    const dialog = await screen.findByRole("dialog", { name: "안뇽이 말풍선" });
    await within(dialog).findByText(game.title);
    expect(within(dialog).getByText(game.title)).toBeTruthy();
    expect(within(dialog).queryByLabelText("무입력 확인")).toBeNull();
  });
  it.each(["consent", "collecting"] as const)("clears raw observations after native %s is withdrawn", async field => {
    await start();
    await screen.findByLabelText("YouTube 활동 확인");
    mocks.native = { ...mocks.native, [field]: false };
    await sample();
    expect(cloudMemory.read()).toMatchObject({ ask: null, reason: "" });
    expect(judging()).toHaveLength(1);
    expect(mocks.session.running).toBe(true);
  });
  it("does not cache a late judgment after native consent withdrawal", async () => {
    let finish!: (response: Response) => void;
    const base = respond;
    let judgments = 0;
    respond = path => path === "/judge" && judgments++ === 0 ? new Promise(resolve => { finish = resolve; }) : base(path);
    await start();
    await waitFor(() => expect(judging()).toHaveLength(1));
    mocks.native = { consent: false, collecting: false };
    await sample();
    await act(async () => finish(Response.json({ action: "ask", reason: "늦은 합성 응답" })));
    expect(cloudMemory.read()).toMatchObject({ ask: null, reason: "" });
    mocks.native = { consent: true, collecting: true };
    await sample();
    await waitFor(() => expect(judging()).toHaveLength(2));
    expect(cloudMemory.read()?.reason).not.toBe("늦은 합성 응답");
  });
  it("blocks feedback queued before native consent withdrawal", async () => {
    await start();
    await screen.findByLabelText("YouTube 활동 확인");
    mocks.native = { consent: false, collecting: false };
    fireEvent.click(screen.getByRole("button", { name: "공부 중인데?" }));
    await sample();
    expect(requests.filter(request => request.path === "/judge/feedback")).toHaveLength(0);
    expect(cloudMemory.read()?.ask).toBeNull();
  });
  it("clears raw question and reason after AI revocation and clears all memory on end", async () => {
    await start();
    await screen.findByLabelText("YouTube 활동 확인");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(cloudMemory.read()).toMatchObject({ ask: null, reason: "" });
    fireEvent.click(screen.getByRole("button", { name: "세션 종료" }));
    await waitFor(() => expect(cloudMemory.read()).toBeNull());
    expect(cloudMemory.dismissed()).toEqual([]);
  });
  it("never persists observed video or session data in localStorage", async () => {
    const write = vi.spyOn(Storage.prototype, "setItem");
    await start();
    await screen.findByLabelText("YouTube 활동 확인");
    const activityWrites = write.mock.calls.filter(([name]) => name.startsWith(key));
    expect(activityWrites).toHaveLength(0);
    write.mockRestore();
  });
  it.each([
    ["전자기 유도 강의", "study", "ignore", false],
    [game.title, "other", "ask", true],
    ["무슨 내용인지 애매한 영상", "other", "ask", true],
    ["잔잔한 피아노 연주", "background", "ignore", false],
  ] as const)("handles %s according to mocked API action", async (title, category, action, asks) => {
    mocks.invoke.mockResolvedValue([{ ...game, title }]);
    const base = respond;
    respond = path => path === "/judge" ? Promise.resolve(Response.json({ category, action, reason: "합성" })) : base(path);
    await start();
    await waitFor(() => expect(judging()).toHaveLength(1));
    await sample();
    expect(!!screen.queryByLabelText("YouTube 활동 확인")).toBe(asks);
    expect(judging()[0].body).toEqual({ session_id: 23, title, video_id: game.videoId });
  });
  it.each(["consent", "end"])("ignores an IPC observation resolving after %s", async stop => {
    let finish!: (videos: typeof game[]) => void;
    mocks.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await start();
    await waitFor(() => expect(typeof finish).toBe("function"));
    if (stop === "consent") fireEvent.click(screen.getByRole("checkbox"));
    else fireEvent.click(screen.getByRole("button", { name: "세션 종료" }));
    await act(async () => { finish([game]); });
    await sample();
    expect(judging()).toHaveLength(0);
  });
  it.each(["consent", "end"])("does not restore a late judgment after %s", async stop => {
    let finish!: (response: Response) => void;
    const base = respond;
    respond = path => path === "/judge" ? new Promise(resolve => { finish = resolve; }) : base(path);
    await start();
    await waitFor(() => expect(judging()).toHaveLength(1));
    if (stop === "consent") fireEvent.click(screen.getByRole("checkbox"));
    else fireEvent.click(screen.getByRole("button", { name: "세션 종료" }));
    await act(async () => finish(Response.json({ action: "ask", reason: "합성" })));
    await sample();
    expect(screen.queryByLabelText("YouTube 활동 확인")).toBeNull();
    expect(judging()).toHaveLength(1);
    if (stop === "end") expect(localStorage.getItem(key)).toBeNull();
  });
  it("retains correction across video switches without another judgment for the corrected ID", async () => {
    await start();
    await screen.findByLabelText("YouTube 활동 확인");
    fireEvent.click(screen.getByRole("button", { name: "공부 중인데?" }));
    await waitFor(() => expect(screen.queryByLabelText("YouTube 활동 확인")).toBeNull());
    mocks.invoke.mockResolvedValue([{ title: "다른 합성 영상", videoId: "zyxwvutsrqp" }]);
    await sample();
    await screen.findByLabelText("YouTube 활동 확인");
    mocks.invoke.mockResolvedValue([game]);
    await sample();
    expect(screen.queryByLabelText("YouTube 활동 확인")).toBeNull();
    expect(judging()).toHaveLength(2);
    const feedback = requests.filter(request => request.path === "/judge/feedback");
    expect(feedback).toMatchObject([{ path: "/judge/feedback", body: { session_id: 23, title: game.title, video_id: game.videoId } }]);
  });
  it("acknowledges distraction, keeps focus running, and suppresses a repeat for the same video", async () => {
    await start();
    await screen.findByLabelText("YouTube 활동 확인");
    fireEvent.click(screen.getByRole("button", { name: "돌아갈게..." }));
    await sample(); await sample();
    expect(screen.queryByLabelText("YouTube 활동 확인")).toBeNull();
    expect(mocks.session.running).toBe(true);
    expect(judging()).toHaveLength(1);
    expect(requests.some(request => request.path === "/plan/wasted")).toBe(false);
  });
  it.each([404, 409, "missing-key", "malformed"] as const)("fails closed for %s AI responses without automatic retries", async failure => {
    const base = respond;
    respond = async path => {
      if (path !== "/judge") return base(path);
      if (failure === "missing-key") return Response.json({ detail: "ANTHROPIC_API_KEY" }, { status: 503 });
      if (failure === "malformed") return Response.json({ action: "unexpected" });
      return Response.json({}, { status: failure });
    };
    await start();
    await screen.findByRole("alert");
    await advance(60_000);
    expect(screen.queryByLabelText("YouTube 활동 확인")).toBeNull();
    expect(judging()).toHaveLength(1);
  });
  it.each([502, 503, 504, "network"] as const)("recovers from %s at five seconds and opens the widget question", async failure => {
    const base = respond;
    let first = true;
    respond = async path => {
      if (path !== "/judge" || !first) return base(path);
      first = false;
      if (failure === "network") throw new TypeError("offline");
      return Response.json({}, { status: failure });
    };
    await start(true);
    const initial = judging()[0].at;
    await advance(initial + 4999 - Date.now());
    expect(judging()).toHaveLength(1);
    await advance(1);
    expect(judging()).toHaveLength(2);
    expect(judging()[1].at - initial).toBe(5000);
    expect(within(screen.getByRole("dialog", { name: "안뇽이 말풍선" }))
      .getByLabelText("YouTube 활동 확인")).toBeTruthy();
    await advance(45_000);
    expect(judging()).toHaveLength(2);
  });
  it("stops after exactly three retries with 5, 15 and 30 second backoff", async () => {
    const base = respond;
    respond = path => path === "/judge" ? Promise.resolve(Response.json({}, { status: 502 })) : base(path);
    await start();
    await advance(110_000);
    const initial = judging()[0].at;
    expect(judging().map(entry => entry.at - initial)).toEqual([0, 5000, 20000, 50000]);
    expect(screen.getByRole("alert").textContent).toContain("자동 재시도 중지");
  });
  it.each(["video", "end", "pause", "consent"])("cancels polling retries after %s changes", async stop => {
    const base = respond;
    respond = path => path === "/judge" ? Promise.resolve(Response.json({}, { status: 504 })) : base(path);
    const view = await start();
    if (stop === "video") mocks.invoke.mockResolvedValue([]);
    if (stop === "consent") fireEvent.click(screen.getByRole("checkbox"));
    if (stop === "end") fireEvent.click(screen.getByRole("button", { name: "세션 종료" }));
    if (stop === "pause") {
      mocks.session.paused = true;
      view.rerender(<CloudSession />);
    }
    await advance(60_000);
    expect(judging()).toHaveLength(1);
  });
  it("keeps one in-flight request per video and aborts it when the video disappears", async () => {
    const base = respond;
    let complete!: (response: Response) => void;
    respond = path => path === "/judge" ? new Promise(resolve => { complete = resolve; }) : base(path);
    await start();
    await advance(8000);
    expect(judging()).toHaveLength(1);
    expect(judging()[0].signal?.aborted).toBe(false);
    mocks.invoke.mockResolvedValue([]);
    await sample();
    expect(judging()[0].signal?.aborted).toBe(true);
    await act(async () => complete(Response.json({ action: "ask", category: "other", reason: "늦은 결과" })));
    expect(screen.queryByLabelText("YouTube 활동 확인")).toBeNull();
  });
  it("honors the session-wide 429 even when the video changes", async () => {
    const base = respond;
    respond = path => path === "/judge" ? Promise.resolve(Response.json({}, { status: 429 })) : base(path);
    await start();
    mocks.invoke.mockResolvedValue([{ title: "다른 영상", videoId: "zyxwvutsrqp" }]);
    await advance(60_000);
    expect(judging()).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).toContain("이 세션의 AI 판단 횟수");
  });
  it("removes a question on AI consent revocation and sends no new video", async () => {
    await start();
    await screen.findByLabelText("YouTube 활동 확인");
    fireEvent.click(screen.getByRole("checkbox"));
    mocks.invoke.mockResolvedValue([{ title: "동의 철회 후 합성 영상", videoId: "zyxwvutsrqp" }]);
    await sample();
    expect(screen.queryByLabelText("YouTube 활동 확인")).toBeNull();
    expect(judging()).toHaveLength(1);
  });
  it("opens the YouTube bubble and submits correction directly without clicking the pet first", async () => {
    await start(true);
    await screen.findByRole("button", { name: /^안뇽이: 딴짓 의심/ });
    const dialog = await screen.findByRole("dialog", { name: "안뇽이 말풍선" });
    expect(within(dialog).getByText("전자기 유도 공부")).toBeTruthy();
    expect(within(dialog).getByText(game.title)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "공부 중인데?" }));
    await screen.findByRole("button", { name: /^안뇽이: 집중 중/ });
    expect(screen.queryByText(game.title)).toBeNull();
    await waitFor(() => expect(within(dialog).queryByRole("button", { name: "공부 중인데?" })).toBeNull());
    expect(requests.filter(request => request.path === "/judge/feedback")).toHaveLength(1);
  });
});
