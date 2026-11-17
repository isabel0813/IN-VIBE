import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import Widget from "./Widget";
import { sessionStore } from "../session/store";
import { characterStates } from "../session/model";
import { characterCopy } from "./character";
import { previewPlacement } from "./geometry";
import { cloudMemory } from "../components/cloudMemory";

beforeEach(async () => {
  cloudMemory.reset();
  await sessionStore.send({ type: "end" });
});
afterEach(() => { cloudMemory.reset(); vi.unstubAllGlobals(); });
const clickPet = () =>
  fireEvent.click(screen.getByRole("button", { name: /^안뇽이:/ }));

describe("Annyong widget preview behavior", () => {
  it("shows the five-minute reminder without stealing focus or opening the bubble", async () => {
    const value = { id: 99, task: "공부", ask: { title: "합성 영상", video_id: "abcdefghijk" }, reason: "합성 판단", stage: 1 as const };
    cloudMemory.set(value);
    render(<Widget native={false} />);
    expect(screen.getByText("잠깐, 확인!")).toBeTruthy();
    await act(() => cloudMemory.set({ ...value, stage: 2 }));
    expect(screen.getByText("아직 보고 있뇽?")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
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
  it("asks the main window for a new task without ending the session", async () => {
    await sessionStore.send({ type: "start", task: { id: 3, name: "이어 할 일" } });
    const navigate = vi.fn();
    window.addEventListener("main-navigate", navigate);
    render(<Widget native={false} />); clickPet();
    expect(screen.queryByRole("button", { name: "최소화" })).toBeNull();
    expect(screen.queryByRole("button", { name: "숨김" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "할 일 바꾸기" }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect((navigate.mock.calls[0][0] as CustomEvent).detail).toBe("input");
    expect(sessionStore.getSnapshot().session.running).toBe(true);
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
});
