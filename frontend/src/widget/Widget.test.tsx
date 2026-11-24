import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import Widget from "./Widget";
import { sessionStore } from "../session/store";
import { characterStates } from "../session/model";
import { characterCopy } from "./character";
import { bubblePlacement, previewPlacement } from "./geometry";
import { cloudMemory } from "../components/cloudMemory";
import { activityApi, emptyActivity, useActivity } from "../activity/bridge";
import { closedLayout, nativeWidget } from "../desktop/bridge";
import type { WidgetLayout } from "../desktop/bridge";

vi.mock("../activity/bridge", async original => ({
  ...await original<typeof import("../activity/bridge")>(),
  useActivity: vi.fn(),
}));

beforeEach(async () => {
  cloudMemory.reset();
  vi.mocked(useActivity).mockReturnValue({ activity: emptyActivity, error: "", ready: true });
  await sessionStore.send({ type: "end" });
});
afterEach(() => { cloudMemory.reset(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const clickPet = () =>
  fireEvent.click(screen.getByRole("button", { name: /^안뇽이:/ }));

describe("Annyong widget preview behavior", () => {
  it("opens YouTube with direct responses and escalates without stealing focus", async () => {
    await sessionStore.send({ type: "start", task: { id: 99, name: "공부" } });
    const value = { id: 99, task: "공부", ask: { title: "합성 영상", video_id: "abcdefghijk" }, reason: "합성 판단", stage: 1 as const };
    render(<><button>작업 창</button><Widget native={false} /></>);
    const foreground = screen.getByRole("button", { name: "작업 창" });
    foreground.focus();
    await act(() => cloudMemory.set(value));
    const dialog = screen.getByRole("dialog", { name: "안뇽이 말풍선" });
    const firstLine = dialog.querySelector('[data-dialogue-stage="1"]')?.textContent;
    expect(firstLine).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "공부 중인데?" })).toBeTruthy();
    expect(document.activeElement).toBe(foreground);
    fireEvent.pointerDown(foreground);
    expect(screen.getByRole("dialog")).toBe(dialog);
    await act(() => cloudMemory.set({ ...value, stage: 2 }));
    const stronger = dialog.querySelector('[data-dialogue-stage="2"]')?.textContent;
    expect(stronger).toBeTruthy();
    expect(stronger).not.toBe(firstLine);
    expect(within(dialog).getByRole("button", { name: "돌아갈게..." })).toBeTruthy();
    expect(document.activeElement).toBe(foreground);
    await act(() => cloudMemory.set({ ...value, stage: 3 }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("opens a native inactivity bubble, keeps its buttons after input, and activates only on interaction", async () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    await sessionStore.send({ type: "start", task: { id: 1, name: "공부" } });
    const incident = { id: 7, kind: "inactivity" as const, stage: 1, startedAt: 0, seconds: 60, process: "", title: "", claimed: false };
    const setActivity = (pending: typeof incident | null, consent = true) => vi.mocked(useActivity).mockReturnValue({
      activity: { ...emptyActivity, consent, incident: pending }, error: "", ready: true,
    });
    setActivity(incident);
    let emitLayout = (_layout: WidgetLayout) => {};
    vi.spyOn(nativeWidget, "listenLayout").mockImplementation(async callback => {
      emitLayout = callback;
      return () => {};
    });
    vi.spyOn(nativeWidget, "readLayout").mockResolvedValue(closedLayout);
    const resize = vi.spyOn(nativeWidget, "bubble").mockImplementation(async (open, automatic = false) => {
      const next = { ...closedLayout, open, automatic, width: open ? 340 : 80, height: open ? 440 : 80 };
      emitLayout(next);
      return next;
    });
    const interact = vi.spyOn(nativeWidget, "interact").mockResolvedValue(undefined);
    const respond = vi.spyOn(activityApi, "respond").mockResolvedValue(emptyActivity);
    const view = render(<Widget native />);
    const dialog = await screen.findByRole("dialog");
    expect(resize).toHaveBeenCalledExactlyOnceWith(true, true);
    expect(interact).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "돌아갈게..." })).toBeTruthy();

    setActivity({ ...incident, stage: 0 });
    view.rerender(<Widget native />);
    fireEvent.pointerMove(document.body);
    fireEvent.blur(window);
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(resize).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(within(dialog).getByRole("button", { name: "공부 중인데?" }), { button: 0 });
    expect(interact).toHaveBeenCalledOnce();
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "공부 중인데?" })); });
    expect(respond).toHaveBeenCalledExactlyOnceWith(7, "studying");
    await act(async () => {
      setActivity(null);
      view.rerender(<Widget native />);
    });
    const reply = within(screen.getByRole("dialog")).getByRole("status", { name: "오탐 정정 안내" });
    expect(reply.querySelector(".persona-line")?.textContent).toBeTruthy();

    await act(async () => {
      setActivity({ ...incident, id: 8 });
      view.rerender(<Widget native />);
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => {
      setActivity(null, false);
      view.rerender(<Widget native />);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("does not reopen the same automatic stage across lost or switched observations", async () => {
    await sessionStore.send({ type: "start", task: { id: 99, name: "공부" } });
    vi.mocked(useActivity).mockReturnValue({
      activity: { ...emptyActivity, consent: true }, error: "", ready: true,
    });
    let emitLayout = (_layout: WidgetLayout) => {};
    vi.spyOn(nativeWidget, "listenLayout").mockImplementation(async callback => {
      emitLayout = callback;
      return () => {};
    });
    vi.spyOn(nativeWidget, "readLayout").mockResolvedValue(closedLayout);
    const resize = vi.spyOn(nativeWidget, "bubble").mockImplementation(async (open, automatic = false) => {
      const next = { ...closedLayout, open, automatic };
      emitLayout(next);
      return next;
    });
    const value = { id: 99, task: "공부", ask: { title: "합성 영상", video_id: "abcdefghijk" }, reason: "합성 판단", stage: 1 as const };
    render(<Widget native />);
    await act(() => cloudMemory.set(value));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    const openings = () => resize.mock.calls.filter(([open, automatic]) => open && automatic);
    expect(openings()).toHaveLength(1);

    // The controller withdraws the question on ads, pause or missing samples.
    for (let gap = 0; gap < 3; gap++) {
      await act(() => cloudMemory.set({ ...value, ask: null, stage: undefined }));
      expect(screen.queryByRole("dialog")).toBeNull();
      await act(() => cloudMemory.set({ ...value, dialogueId: `reobserved-${gap}` }));
    }
    expect(openings()).toHaveLength(1);

    const second = { ...value, stage: 2 as const };
    await act(() => cloudMemory.set(second));
    expect(openings()).toHaveLength(2);
    await act(() => cloudMemory.set({ ...second, ask: { ...value.ask, video_id: "lmnopqrstuv" } }));
    expect(openings()).toHaveLength(3);
    await act(() => cloudMemory.set(second));
    expect(openings()).toHaveLength(3);

    const incident = { id: 7, kind: "inactivity" as const, stage: 1, startedAt: 0, seconds: 300, process: "", title: "", claimed: false };
    vi.mocked(useActivity).mockReturnValue({
      activity: { ...emptyActivity, consent: true, incident }, error: "", ready: true,
    });
    // A native inactivity incident underneath a YouTube question must not open another bubble.
    await act(() => cloudMemory.set(second));
    expect(openings()).toHaveLength(3);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByLabelText("YouTube 활동 확인")).toBeTruthy();

    // The controller owns the existing grace periods. Its next prompt after
    // that period must be eligible even when it goes back to stage 1.
    await act(() => cloudMemory.dismiss(value.id, value.ask.video_id, "study"));
    vi.mocked(useActivity).mockReturnValue({
      activity: { ...emptyActivity, consent: true }, error: "", ready: true,
    });
    await act(() => cloudMemory.set(value));
    expect(openings()).toHaveLength(5); // one inactivity, then one rearmed YouTube
  });

  it("only opens on click and closes on Escape or outside pointerdown", () => {
    render(<Widget native={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    clickPet();
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    clickPet();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("keeps a manual native bubble on webview blur and reopens after native dismissal", async () => {
    let emitLayout = (_layout: WidgetLayout) => {};
    vi.spyOn(nativeWidget, "listenLayout").mockImplementation(async listener => {
      emitLayout = listener;
      return () => {};
    });
    vi.spyOn(nativeWidget, "readLayout").mockResolvedValue(closedLayout);
    const opened = { ...closedLayout, open: true, automatic: false, width: 340, height: 440 };
    const resize = vi.spyOn(nativeWidget, "bubble").mockImplementation(async open => {
      const next = open ? opened : closedLayout;
      emitLayout(next);
      return next;
    });

    render(<Widget native />);
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: /^안뇽이:/ }).disabled).toBe(false));
    clickPet();
    await screen.findByRole("dialog");
    fireEvent(window, new Event("blur"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(resize).toHaveBeenCalledExactlyOnceWith(true, false);

    await act(() => emitLayout(closedLayout));
    expect(screen.queryByRole("dialog")).toBeNull();
    clickPet();
    await screen.findByRole("dialog");
    expect(resize.mock.calls).toEqual([[true, false], [true, false]]);
  });
  it("moves a web preview without opening a bubble on a drag", () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    render(<Widget native={false} />);
    const pet = screen.getByRole("button", { name: /^안뇽이:/ });
    const stage = screen.getByLabelText("안뇽이 웹 미리보기");
    const previousLeft = stage.style.left;
    fireEvent.pointerDown(pet, { button: 0, buttons: 1, clientX: 950, clientY: 700 });
    fireEvent.pointerMove(pet, { buttons: 1, clientX: 850, clientY: 600 });
    fireEvent.pointerUp(pet);
    fireEvent.click(pet);
    expect(stage.style.left).not.toBe(previousLeft);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("changes the task from the widget input without opening the main window", async () => {
    await sessionStore.send({ type: "start", task: { id: 3, name: "이어 할 일" } });
    const navigate = vi.fn();
    window.addEventListener("main-navigate", navigate);
    const handler = vi.fn(async () => true);
    const stop = cloudMemory.handleChange(handler);
    render(<Widget native={false} />); clickPet();
    expect(screen.queryByRole("button", { name: "최소화" })).toBeNull();
    expect(screen.queryByRole("button", { name: "숨김" })).toBeNull();
    const input = screen.getByRole("textbox", { name: "할 일 바꾸기" }) as HTMLInputElement;
    expect(input.placeholder).toBe("할 일 바꾸기");
    expect(screen.queryByRole("button", { name: "새 할 일 보내기" })).toBeNull();
    fireEvent.change(input, { target: { value: "  자기장 공부  " } });
    fireEvent.click(screen.getByRole("button", { name: "새 할 일 보내기" }));
    await waitFor(() => expect(handler).toHaveBeenCalledWith("자기장 공부"));
    await waitFor(() => expect(input.value).toBe(""));
    expect(navigate).not.toHaveBeenCalled();
    stop();
    window.removeEventListener("main-navigate", navigate);
  });
  it("pauses, resumes, navigates and ends the same session", async () => {
    await sessionStore.send({
      type: "start",
      task: { id: 12, name: "진짜 선택된 과제" },
    });
    const navigate = vi.fn();
    window.addEventListener("main-navigate", navigate);
    render(<Widget native={false} />);
    clickPet();
    expect(screen.getByText("진짜 선택된 과제")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "일시정지" }));
    fireEvent.click(screen.getByRole("button", { name: "쉬기 시작" }));
    const resume = await screen.findByRole("button", {
      name: "재개",
    });
    await waitFor(() =>
      expect((resume as HTMLButtonElement).disabled).toBe(false),
    );
    expect(sessionStore.getSnapshot().session.paused).toBe(true);
    fireEvent.click(resume);
    await waitFor(() =>
      expect(sessionStore.getSnapshot().session.paused).toBe(false),
    );
    const plan = screen.getByRole("button", { name: "집중 화면 열기" });
    await waitFor(() =>
      expect((plan as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(plan);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((navigate.mock.calls[0][0] as CustomEvent).detail).toBe("plan");
    clickPet();
    fireEvent.click(screen.getByRole("button", { name: "종료" }));
    await waitFor(() =>
      expect(sessionStore.getSnapshot().session.running).toBe(false),
    );
    window.removeEventListener("main-navigate", navigate);
  });
  it.each(characterStates)(
    "shows %s without auto-opening a bubble",
    async (character) => {
      render(<Widget native={false} />);
      await act(() => sessionStore.send({ type: "character", character }));
      expect(screen.queryByRole("dialog")).toBeNull();
      clickPet();
      // 말풍선에는 상태 이름만 보이고, 캐릭터 대사는 보이지 않는다.
      expect(screen.getByText(characterCopy[character].label)).toBeTruthy();
      expect(screen.queryByText(characterCopy[character].line)).toBeNull();
      expect(
        screen.getByText(/개발 시뮬레이션 · 실제 활동 감지 없음/),
      ).toBeTruthy();
    },
  );
  it("never reports fake distraction time or calls wasted API on checkin", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await sessionStore.send({ type: "start", task: { id: 1, name: "공부" } });
    await sessionStore.send({ type: "character", character: "checkin" });
    render(<Widget native={false} />);
    clickPet();
    expect(
      screen.getByRole("button", { name: "아니, 공부 중이었어" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "잠깐 쉬는 중이야" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "맞아, 딴짓했어" }));
    await screen.findByText(/딴짓 시간은 측정하지 않았어/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    [0, 0],
    [940, 0],
    [0, 680],
    [940, 680],
  ])("keeps the bubble in the viewport at %i,%i", (x, y) => {
    const result = previewPlacement(x, y, 1024, 768, true);
    expect(result.left).toBeGreaterThanOrEqual(0);
    expect(result.top).toBeGreaterThanOrEqual(0);
    expect(result.left + result.layout.width).toBeLessThanOrEqual(1024);
    expect(result.top + result.layout.height).toBeLessThanOrEqual(768);
    expect(result.left + result.layout.petX).toBe(x);
    expect(result.top + result.layout.petY).toBe(y);
  });
  it.each([0, 145])("gives the bubble a scrollable hit area within a small work area at y=%i", (y) => {
    const { layout } = previewPlacement(190, y, 290, 230, true);
    const { style } = bubblePlacement(layout);
    const top = "bottom" in style ? layout.height - (style.bottom ?? 0) - style.maxHeight : style.top;
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top + style.maxHeight).toBeLessThanOrEqual(layout.height - 8);
    expect(style.maxHeight).toBeGreaterThan(0);
  });
});
