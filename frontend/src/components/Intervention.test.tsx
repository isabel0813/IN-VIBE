import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InterventionClock } from "./intervention";

const mocks = vi.hoisted(() => ({
  session: { running: false, paused: false, task: null as null | { id: number; name: string } },
  native: { consent: true, collecting: true },
  videos: [{ title: "Minecraft gameplay", videoId: "abcdefghijk" }],
  show: vi.fn(), commands: vi.fn(),
}));
vi.mock("../desktop/bridge", () => ({ isDesktop: () => true, showWidget: mocks.show }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (command: string, args: unknown) => {
  mocks.commands(command, args);
  if (command === "browser_read") return mocks.native;
  if (command === "browser_videos") return mocks.videos;
} }));
vi.mock("../session/store", () => ({
  useFocusSession: () => ({ session: mocks.session, ready: true }),
  sessionStore: { send: async (action: { type: string; task?: { id: number; name: string } }) => {
    mocks.session = { running: action.type === "start", paused: false, task: action.task ?? null };
  } },
}));
import CloudSession, { UltimateOverlay, useCloudController } from "./CloudSession";
import { cloudMemory } from "./cloudMemory";
import { api } from "../api/client";
import { activityApi, emptyActivity } from "../activity/bridge";
import { ultimateArt } from "../widget/character";

beforeEach(() => {
  localStorage.clear(); cloudMemory.reset(); vi.clearAllMocks();
  mocks.session = { running: false, paused: false, task: null };
  mocks.native = { consent: true, collecting: true };
  mocks.videos = [{ title: "Minecraft gameplay", videoId: "abcdefghijk" }];
  vi.spyOn(api, "startSession").mockResolvedValue({ id: 91, task: "물리학2 패러데이 법칙 공부하기" });
  vi.spyOn(api, "endSession").mockResolvedValue({});
  vi.spyOn(api, "judge").mockResolvedValue({ action: "ask", category: "other", reason: "합성 판단" });
  vi.spyOn(api, "feedback").mockResolvedValue({});
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("Live network forbidden"); }));
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function start(consent = true) {
  const view = render(<><CloudSession /><UltimateOverlay /></>);
  fireEvent.change(screen.getByLabelText("지금 공부할 일"), { target: { value: "물리학2 패러데이 법칙 공부하기" } });
  if (consent) fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "집중 시작" }));
  await waitFor(() => expect(mocks.show).toHaveBeenCalled());
  return view;
}

it("escalates at exactly 1, 5 and 10 observed minutes without treating silence as an answer", async () => {
  await start();
  await advance(59_000); expect(cloudMemory.read()?.ask).toBeNull();
  await advance(1000); expect(cloudMemory.read()?.stage).toBe(1);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  await advance(239_000); expect(cloudMemory.read()?.stage).toBe(1);
  await advance(1000); expect(cloudMemory.read()?.stage).toBe(2);
  expect(screen.getByText(/5분|연관 영상/)).toBeTruthy();
  await advance(299_000); expect(cloudMemory.read()?.stage).toBe(2);
  await advance(1000); expect(cloudMemory.read()?.stage).toBe(3);
  expect(screen.getByRole("alertdialog", { name: "안뇽이 궁극기" })).toBeTruthy();
  expect(mocks.commands.mock.calls.filter(([command]) => command === "ultimate_show")).toEqual([["ultimate_show", { taskId: 1_000_000_000_091 }]]);
  await advance(20_000);
  expect(api.feedback).not.toHaveBeenCalled(); expect(api.endSession).not.toHaveBeenCalled();
  expect(api.judge).toHaveBeenCalledTimes(1); expect(cloudMemory.dismissed()).toEqual([]);
  const dialog = screen.getByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "공부 중인데?" }));
  await waitFor(() => expect(cloudMemory.read()?.ask).toBeNull());
  await advance(600_000);
  expect(api.feedback).toHaveBeenCalledTimes(1); expect(api.judge).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(mocks.commands.mock.calls.some(([command]) => command === "ultimate_hide")).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
}, 20_000);
it("does not advance time while the video is hidden or paused", async () => {
  await start(); await advance(30_000);
  mocks.videos = []; await advance(600_000);
  expect(cloudMemory.read()?.ask).toBeNull();
  mocks.videos = [{ title: "Minecraft gameplay", videoId: "abcdefghijk" }];
  await advance(30_000); expect(cloudMemory.read()?.ask).toBeNull();
  await advance(1000); expect(cloudMemory.read()?.stage).toBe(1);
});
it("keeps one fullscreen open when it covers Chrome and closes once on feedback", async () => {
  await start();
  await advance(600_000);
  const dialog = screen.getByRole("alertdialog");
  const sampled = mocks.commands.mock.calls.filter(([command]) => command === "browser_videos").length;
  for (let i = 0; i < 3; i++) {
    mocks.videos = [];
    await advance(2000);
    mocks.videos = [{ title: "Minecraft gameplay", videoId: "abcdefghijk" }];
    await advance(2000);
    expect(screen.getByRole("alertdialog")).toBe(dialog);
  }
  expect(mocks.commands.mock.calls.filter(([command]) => command === "browser_videos")).toHaveLength(sampled);
  expect(mocks.commands.mock.calls.filter(([command]) => command.startsWith("ultimate_"))).toEqual([
    ["ultimate_show", { taskId: 1_000_000_000_091 }],
  ]);
  expect(api.feedback).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "공부 중인데?" })); });
  await advance(3000);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(api.feedback).toHaveBeenCalledOnce();
  expect(mocks.commands.mock.calls.filter(([command]) => command === "ultimate_hide")).toHaveLength(1);
  expect(mocks.commands.mock.calls.filter(([command]) => command === "ultimate_show")).toHaveLength(1);
});
it.each(["ai", "native", "pause", "end"])("removes the fullscreen question and drops delayed work after %s", async stop => {
  const view = await start(); await advance(600_000);
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  if (stop === "ai") fireEvent.click(screen.getByRole("checkbox"));
  if (stop === "native") mocks.native = { consent: false, collecting: false };
  if (stop === "pause") {
    mocks.session.paused = true;
    await act(async () => { view.rerender(<><CloudSession /><UltimateOverlay /></>); });
  }
  if (stop === "end") fireEvent.click(screen.getByRole("button", { name: "세션 종료" }));
  await advance(2000);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(mocks.commands.mock.calls.some(([command]) => command === "ultimate_hide")).toBe(true);
  const calls = vi.mocked(api.judge).mock.calls.length;
  await advance(600_000); expect(api.judge).toHaveBeenCalledTimes(calls);
});
it("never escalates background or ignored videos and never judges without AI consent", async () => {
  vi.mocked(api.judge).mockResolvedValue({ action: "ignore", category: "study", reason: "공부" });
  await start(); await advance(600_000); expect(cloudMemory.read()?.ask).toBeNull();
  mocks.videos = [{ title: "lofi background music", videoId: "zyxwvutsrqp" }];
  await advance(600_000); expect(api.judge).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("checkbox"));
  mocks.videos = [{ title: "new gameplay", videoId: "123456789ab" }];
  await advance(600_000); expect(api.judge).toHaveBeenCalledTimes(1);
});
it("keeps per-video time separate and ignores sleep or duplicate observation IDs", () => {
  const clock = new InterventionClock();
  for (let now = 0; now <= 30_000; now += 1000) clock.observe(["a", "a"], now);
  clock.pause(); clock.observe(["a"], 500_000);
  expect(clock.stage("a")).toBe(0);
  for (let now = 501_000; now <= 529_000; now += 1000) clock.observe(["a"], now);
  expect(clock.stage("a")).toBe(0);
  clock.observe(["a", "b"], 530_000);
  expect(clock.stage("a")).toBe(1); expect(clock.stage("b")).toBe(0);
  clock.clear(); expect(clock.stage("a")).toBe(0);
});
it("waits for additional valid viewing after return and starts a fresh 1/5/10 cycle", () => {
  const clock = new InterventionClock();
  clock.rearm("a", "return", 0);
  for (let t = 0; t <= 300_000; t += 1000) clock.observe(["a"], t);
  clock.observe([], 301_000);
  for (let t = 900_000; t < 1_260_000; t += 1000) clock.observe(["a"], t);
  expect(clock.stage("a")).toBe(0);
  clock.observe(["a"], 1_260_000); expect(clock.stage("a")).toBe(1);
  for (let t = 1_261_000; t <= 1_500_000; t += 1000) clock.observe(["a"], t);
  expect(clock.stage("a")).toBe(2);
  for (let t = 1_501_000; t <= 1_800_000; t += 1000) clock.observe(["a"], t);
  expect(clock.stage("a")).toBe(3);
});
it("gives a corrected video 30 minutes and then measures a fresh interval", () => {
  const clock = new InterventionClock();
  clock.rearm("a", "study", 0);
  for (let t = 0; t < 1_860_000; t += 1000) clock.observe(["a", "b"], t);
  expect(clock.stage("a")).toBe(0);
  expect(clock.stage("b")).toBe(3);
  clock.observe(["a"], 1_860_000); expect(clock.stage("a")).toBe(1);
});
it("reopens the same video's first stage after a return without judging it twice", async () => {
  await start();
  await advance(60_000);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "돌아갈게..." })); });
  expect(cloudMemory.read()?.ask).toBeNull();
  await advance(660_000);
  expect(cloudMemory.read()?.ask).toBeNull();
  await advance(1000);
  expect(cloudMemory.read()?.stage).toBe(1);
  expect(api.judge).toHaveBeenCalledOnce();
  expect(api.feedback).not.toHaveBeenCalled();
});
it("allows ending focus from the ultimate without classifying silence as distraction", () => {
  const end = vi.fn();
  cloudMemory.set({ id: 91, task: "공부", ask: { title: "합성 영상", video_id: "abcdefghijk" }, reason: "합성 판단", stage: 3 });
  render(<UltimateOverlay onEnd={end} />);
  fireEvent.click(screen.getByRole("button", { name: "집중 세션 종료" }));
  expect(end).toHaveBeenCalledTimes(1);
  expect(api.feedback).not.toHaveBeenCalled();
  expect(cloudMemory.dismissed()).toEqual([]);
});

function InactivityUltimate({ stage = 3, consent = true }: { stage?: number | null; consent?: boolean }) {
  const focus = useCloudController({ ...emptyActivity, consent,
    incident: stage === null ? null : { id: 42, kind: "inactivity", stage, startedAt: 0, seconds: 600, title: "", process: "", claimed: false },
  });
  return <UltimateOverlay inactivity={focus.inactivityUltimate} />;
}

it.each(["answer", "pause", "end", "consent"])("uses the ultimate image and closes the no-input fullscreen on %s", async stop => {
  const respond = vi.spyOn(activityApi, "respond").mockResolvedValue(emptyActivity);
  mocks.session = { running: true, paused: false, task: { id: 123, name: "공부" } };
  const view = render(<InactivityUltimate stage={2} />);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(mocks.commands).not.toHaveBeenCalledWith("ultimate_show", expect.anything());
  await act(async () => { view.rerender(<InactivityUltimate />); });
  const image = within(screen.getByRole("alertdialog")).getByRole("img", { name: "안뇽이 궁극기" });
  expect(image.getAttribute("src")).toBe(ultimateArt);
  await waitFor(() => expect(mocks.commands).toHaveBeenCalledWith("ultimate_show", { taskId: 123, inactivityId: 42 }));
  if (stop === "pause") mocks.session.paused = true;
  if (stop === "end") mocks.session.running = false;
  if (stop === "answer") {
    const dialog = screen.getByRole("alertdialog");
    fireEvent.pointerMove(dialog);
    fireEvent.keyDown(dialog, { key: "Tab" });
    const study = within(dialog).getByRole("button", { name: "공부 중인데?" });
    expect(study).toBeTruthy();
    await act(async () => { fireEvent.click(study); });
    expect(respond).toHaveBeenCalledExactlyOnceWith(42, "studying");
  }
  await act(async () => { view.rerender(<InactivityUltimate stage={stop === "answer" ? null : 3} consent={stop !== "consent"} />); });
  await waitFor(() => expect(mocks.commands).toHaveBeenCalledWith("ultimate_hide", { inactivityId: 42 }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(api.feedback).not.toHaveBeenCalled();
  expect(api.judge).not.toHaveBeenCalled();
});
