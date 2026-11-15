import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: { running: false, paused: false, task: null as null | { id: number; name: string }, character: "idle", simulated: false },
  invoke: vi.fn(), show: vi.fn(), send: vi.fn(),
  native: { consent: true, collecting: true },
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
  useActivity: () => ({ activity: { consent: false, incident: null } }), activityApi: {},
}));
import CloudSession from "./CloudSession";
import Widget from "../widget/Widget";
import { cloudMemory } from "./cloudMemory";

const key = "mobonyong.cloud-session";
const game = { title: "합성 게임 플레이", videoId: "abcdefghijk" };
let requests: { path: string; body: Record<string, unknown> }[];
let respond: (path: string) => Promise<Response>;
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  requests = [];
  mocks.native = { consent: true, collecting: true };
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
    requests.push({ path, body: JSON.parse(String(init.body)) });
    return respond(path);
  }));
  // Only the sampling interval is virtual. No request reaches a real server.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const sample = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); };
const judging = () => requests.filter(request => request.path === "/judge");
async function start(widget = false) {
  const view = render(<><CloudSession />{widget && <Widget native={false} />}</>);
  fireEvent.change(screen.getByLabelText("지금 공부할 일"), { target: { value: "전자기 유도 공부" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "집중 시작" }));
  await waitFor(() => expect(mocks.show).toHaveBeenCalledWith(true));
  return view;
}

describe("synthetic judgment pipeline", () => {
  it.each(["consent", "collecting"] as const)("clears raw observations after native %s is withdrawn", async field => {
    await start();
    await screen.findByText("안뇽이 · 너 혹시 딴짓해?");
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
    await screen.findByText("안뇽이 · 너 혹시 딴짓해?");
    mocks.native = { consent: false, collecting: false };
    fireEvent.click(screen.getByRole("button", { name: "아니? 전혀~" }));
    await sample();
    expect(requests.filter(request => request.path === "/judge/feedback")).toHaveLength(0);
    expect(cloudMemory.read()?.ask).toBeNull();
  });
  it("clears raw question and reason after AI revocation and clears all memory on end", async () => {
    await start();
    await screen.findByText("안뇽이 · 너 혹시 딴짓해?");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(cloudMemory.read()).toMatchObject({ ask: null, reason: "" });
    fireEvent.click(screen.getByRole("button", { name: "세션 종료" }));
    await waitFor(() => expect(cloudMemory.read()).toBeNull());
    expect(cloudMemory.dismissed()).toEqual([]);
  });
  it("never persists observed video or session data in localStorage", async () => {
    const write = vi.spyOn(Storage.prototype, "setItem");
    await start();
    await screen.findByText("안뇽이 · 너 혹시 딴짓해?");
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
    expect(!!screen.queryByText("안뇽이 · 너 혹시 딴짓해?")).toBe(asks);
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
    expect(screen.queryByText("안뇽이 · 너 혹시 딴짓해?")).toBeNull();
    expect(judging()).toHaveLength(1);
    if (stop === "end") expect(localStorage.getItem(key)).toBeNull();
  });
  it("retains correction across video switches without another judgment for the corrected ID", async () => {
    await start();
    await screen.findByText("안뇽이 · 너 혹시 딴짓해?");
    fireEvent.click(screen.getByRole("button", { name: "아니? 전혀~" }));
    await waitFor(() => expect(screen.queryByText("안뇽이 · 너 혹시 딴짓해?")).toBeNull());
    mocks.invoke.mockResolvedValue([{ title: "다른 합성 영상", videoId: "zyxwvutsrqp" }]);
    await sample();
    await screen.findByText("안뇽이 · 너 혹시 딴짓해?");
    mocks.invoke.mockResolvedValue([game]);
    await sample();
    expect(screen.queryByText("안뇽이 · 너 혹시 딴짓해?")).toBeNull();
    expect(judging()).toHaveLength(2);
    const feedback = requests.filter(request => request.path === "/judge/feedback");
    expect(feedback).toEqual([{ path: "/judge/feedback", body: { session_id: 23, title: game.title, video_id: game.videoId } }]);
  });
  it("acknowledges distraction, keeps focus running, and suppresses a repeat for the same video", async () => {
    await start();
    await screen.findByText("안뇽이 · 너 혹시 딴짓해?");
    fireEvent.click(screen.getByRole("button", { name: "맞아, 공부로 돌아갈게" }));
    await sample(); await sample();
    expect(screen.queryByText("안뇽이 · 너 혹시 딴짓해?")).toBeNull();
    expect(mocks.session.running).toBe(true);
    expect(judging()).toHaveLength(1);
    expect(requests.some(request => request.path === "/plan/wasted")).toBe(false);
  });
  it.each(["503", "malformed"])("fails closed for %s AI responses without automatic retries", async failure => {
    const base = respond;
    respond = path => path === "/judge" ? Promise.resolve(failure === "503" ? Response.json({}, { status: 503 }) : Response.json({ action: "unexpected" })) : base(path);
    await start();
    await screen.findByRole("alert");
    await sample(); await sample();
    expect(screen.queryByText("안뇽이 · 너 혹시 딴짓해?")).toBeNull();
    expect(judging()).toHaveLength(1);
  });
  it("removes a question on AI consent revocation and sends no new video", async () => {
    await start();
    await screen.findByText("안뇽이 · 너 혹시 딴짓해?");
    fireEvent.click(screen.getByRole("checkbox"));
    mocks.invoke.mockResolvedValue([{ title: "동의 철회 후 합성 영상", videoId: "zyxwvutsrqp" }]);
    await sample();
    expect(screen.queryByText("안뇽이 · 너 혹시 딴짓해?")).toBeNull();
    expect(judging()).toHaveLength(1);
  });
  it("updates the existing widget expression without automatically opening its bubble", async () => {
    await start(true);
    await screen.findByRole("button", { name: /^안뇽이: 딴짓 의심/ });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^안뇽이:/ }));
    const dialog = screen.getByRole("dialog", { name: "안뇽이 말풍선" });
    expect(within(dialog).getByText("전자기 유도 공부")).toBeTruthy();
    expect(within(dialog).getByText(game.title)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "아니? 전혀~" }));
    await screen.findByRole("button", { name: /^안뇽이: 집중 중/ });
    expect(screen.queryByText(game.title)).toBeNull();
  });
});
