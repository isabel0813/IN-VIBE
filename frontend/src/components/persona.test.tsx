import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CloudQuestion, UltimateOverlay } from "./CloudSession";
import { cloudMemory } from "./cloudMemory";
import { poolFor, profanity } from "./dialogue";
import { DialogueLine, InactivityDialogue, ReplyNotice, useTone } from "./persona";

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Math, "random").mockReturnValue(0);
  cloudMemory.reset();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); cloudMemory.reset(); localStorage.clear(); });

it("shows the same third-stage line and reachable response controls in the main view and ultimate", () => {
  const title = "<img src=x>{task} " + "🎮".repeat(60);
  const state = { id: 22, dialogueId: "shared", task: "물리학", ask: { title, video_id: "abcdefghijk" }, reason: "합성 판단", stage: 3 as const };
  cloudMemory.set(state);
  const view = render(<><CloudQuestion /><UltimateOverlay /></>);
  const question = screen.getByRole("status", { name: "YouTube 활동 확인" });
  const ultimate = screen.getByRole("alertdialog");
  const heading = within(ultimate).getByRole("heading");
  const line = question.querySelector(".persona-line")?.textContent;
  expect(line).toBeTruthy();
  expect(heading.textContent).toBe(line);
  expect(heading.dataset.dialogueStage).toBe("3");
  for (const surface of [question, ultimate]) {
    expect(within(surface).getByRole("button", { name: "돌아갈게..." })).toBeTruthy();
    expect(within(surface).getByRole("button", { name: "공부 중인데?" })).toBeTruthy();
  }
  expect(heading.querySelector("img")).toBeNull();
  view.rerender(<><CloudQuestion /><UltimateOverlay /></>);
  expect(heading.textContent).toBe(line);
  expect(cloudMemory.read()?.ask?.title).toBe(title);
});

function ToneControls() {
  const [, setTone] = useTone();
  return <><button onClick={() => setTone("hardcore")}>하드코어</button>
    <button onClick={() => setTone("default")}>기본</button>
    <DialogueLine eventId="tone-check" group="youtube" stage={1} task="보고서" video="<img>{task} 게임 영상" />
  </>;
}

it("replaces an active hardcore line on opt-out, keeps the setting across mounts and renders variables as text", () => {
  const view = render(<ToneControls />);
  const current = () => view.container.querySelector(".persona-line")?.textContent ?? "";
  const initial = current();
  expect(initial).toContain("<img>｛task｝");
  expect(view.container.querySelector("img")).toBeNull();
  expect(profanity.test(initial)).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "하드코어" }));
  const hardcore = current();
  expect(profanity.test(hardcore)).toBe(true);
  view.rerender(<ToneControls key="new-window" />);
  expect(current()).toBe(hardcore);
  fireEvent.click(screen.getByRole("button", { name: "기본" }));
  expect(current()).toBe(initial);
  expect(profanity.test(current())).toBe(false);
});

it("keeps the second-stage inactivity line when input resumes before an answer", () => {
  const incident = { id: 2, kind: "inactivity" as const, stage: 2, startedAt: 10, seconds: 301, process: "", title: "", claimed: false };
  const view = render(<InactivityDialogue incident={incident} />);
  const first = view.container.textContent;
  expect(first).toBeTruthy();
  view.rerender(<InactivityDialogue incident={{ ...incident, stage: 0 }} />);
  expect(view.container.textContent).toBe(first);
  expect(view.container.querySelector('[data-dialogue-stage="2"]')).toBeTruthy();
});

it("selects different replies for a return and a false-positive correction", () => {
  const view = render(<ReplyNotice task="실험 보고서" reply={{ id: "return-reply", taskId: 22, mode: "return" }} />);
  const returned = screen.getByRole("status", { name: "집중 복귀 안내" }).querySelector(".persona-line")?.textContent;
  expect(poolFor({ tone: "default", group: "return", stage: 1 })).toContain(returned);
  act(() => view.rerender(<ReplyNotice task="실험 보고서" reply={{ id: "study-reply", taskId: 22, mode: "study" }} />));
  const corrected = screen.getByRole("status", { name: "오탐 정정 안내" }).querySelector(".persona-line")?.textContent;
  expect(corrected).toBeTruthy();
  expect(corrected).not.toBe(returned);
  expect(screen.getByText("실험 보고서", { exact: true })).toBeTruthy();
});
