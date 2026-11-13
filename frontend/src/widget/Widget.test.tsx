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

beforeEach(async () => {
  await sessionStore.send({ type: "end" });
});
afterEach(() => vi.unstubAllGlobals());
const clickPet = () =>
  fireEvent.click(screen.getByRole("button", { name: /^안뇽이:/ }));

describe("Annyong widget preview behavior", () => {
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
  it.each(["최소화", "숨김"])("%s returns to the main view and keeps the session intact", async label => {
    await sessionStore.send({ type: "start", task: { id: 3, name: "이어 할 일" } });
    const navigate = vi.fn(), visibility = vi.fn();
    window.addEventListener("main-navigate", navigate);
    window.addEventListener("web-widget-visible", visibility);
    render(<Widget native={false} />); clickPet();
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(visibility).toHaveBeenCalled());
    expect((navigate.mock.calls[0][0] as CustomEvent).detail).toBe("plan");
    expect((visibility.mock.calls[0][0] as CustomEvent).detail).toBe(false);
    expect(sessionStore.getSnapshot().session.running).toBe(true);
    window.removeEventListener("main-navigate", navigate);
    window.removeEventListener("web-widget-visible", visibility);
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
    fireEvent.click(screen.getByRole("button", { name: "집중 세션 일시정지" }));
    const resume = await screen.findByRole("button", {
      name: "집중 세션 재개",
    });
    await waitFor(() =>
      expect((resume as HTMLButtonElement).disabled).toBe(false),
    );
    expect(sessionStore.getSnapshot().session.paused).toBe(true);
    fireEvent.click(resume);
    await waitFor(() =>
      expect(sessionStore.getSnapshot().session.paused).toBe(false),
    );
    const plan = screen.getByRole("button", { name: /계획 보기/ });
    await waitFor(() =>
      expect((plan as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(plan);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((navigate.mock.calls[0][0] as CustomEvent).detail).toBe("plan");
    clickPet();
    fireEvent.click(screen.getByRole("button", { name: "집중 세션 종료" }));
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
      expect(screen.getByText(characterCopy[character].line)).toBeTruthy();
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
