import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { readBreakUntil, setBreakUntil, useAutoResume } from "./breakTimer";
import { sessionStore } from "./store";
import Widget from "../widget/Widget";

function AutoResume() { useAutoResume(); return null; }

beforeEach(async () => {
  localStorage.clear();
  await sessionStore.send({ type: "end" });
});
afterEach(() => setBreakUntil(null));

it("resumes a paused session when the break is over", async () => {
  await sessionStore.send({ type: "start", task: { id: 5, name: "쉬었다 할 일" } });
  await sessionStore.send({ type: "pause" });
  setBreakUntil(Date.now() - 1);
  render(<AutoResume />);
  await waitFor(() => expect(sessionStore.getSnapshot().session.paused).toBe(false));
  expect(readBreakUntil()).toBeNull();
});

it("keeps the session paused until the break ends", async () => {
  await sessionStore.send({ type: "start", task: { id: 6, name: "길게 쉬기" } });
  await sessionStore.send({ type: "pause" });
  setBreakUntil(Date.now() + 60 * 60_000);
  render(<AutoResume />);
  await new Promise(r => setTimeout(r, 50));
  expect(sessionStore.getSnapshot().session.paused).toBe(true);
});

it("shows the 5-minute step slider on hover and pauses for the chosen time", async () => {
  await sessionStore.send({ type: "start", task: { id: 7, name: "슬라이더" } });
  render(<Widget native={false} />);
  fireEvent.click(screen.getByRole("button", { name: /^안뇽이:/ }));
  const pause = screen.getByRole("button", { name: "집중 세션 일시정지" });
  fireEvent.mouseEnter(pause);
  const slider = screen.getByRole("slider", { name: "쉬는 시간(분)" }) as HTMLInputElement;
  expect([slider.min, slider.max, slider.step]).toEqual(["5", "60", "5"]);
  fireEvent.change(slider, { target: { value: "30" } });
  expect(screen.getByText("30분 쉬기")).toBeTruthy();
  await waitFor(() => expect((pause as HTMLButtonElement).disabled).toBe(false));
  const before = Date.now();
  fireEvent.click(pause);
  await waitFor(() => expect(sessionStore.getSnapshot().session.paused).toBe(true));
  await waitFor(() => expect(readBreakUntil()).not.toBeNull());
  const until = readBreakUntil()!;
  expect(until - before).toBeGreaterThanOrEqual(30 * 60_000 - 1000);
  expect(until - before).toBeLessThanOrEqual(30 * 60_000 + 5000);
});
