import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { poolFor, profanity } from "../components/dialogue";
import WebExperience from "./WebExperience";

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const button = (name: string) => screen.getByRole("button", { name });
const outcome = () => screen.getByRole("status", { name: "체험 결과" });
const choose = (value: string) => fireEvent.change(screen.getByLabelText("가상의 활동 선택"), { target: { value } });
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
function start(seed = "물리학 실험 보고서 작성") {
  const view = render(<WebExperience initialTask="" onExit={vi.fn()} />);
  expect((button("체험 시작") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("체험용 할 일"), { target: { value: seed } });
  fireEvent.click(button("체험 시작"));
  return view;
}

it.each(["study", "music"])("observes the %s example without prompting or starting a timer", value => {
  start();
  choose(value);
  expect(within(outcome()).getByText("개입 없음")).toBeTruthy();
  tick(60_000);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.queryByRole("button", { name: "다음 개입 단계" })).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["game", "unrelated"])("shows all three %s stages at the virtual observation boundaries and returns to study", value => {
  start();
  choose(value);
  tick(9999);
  expect(within(outcome()).getByText("체험 관측 중")).toBeTruthy();
  tick(1);
  const first = within(outcome()).getByText("1단계 · 첫 확인");
  const line = outcome().querySelector(".experience-line")?.textContent;
  expect(line).toBeTruthy();
  tick(9999);
  expect(within(outcome()).getByText("1단계 · 첫 확인")).toBe(first);
  expect(outcome().querySelector(".experience-line")?.textContent).toBe(line);
  tick(1);
  expect(within(outcome()).getByText("2단계 · 강화 확인")).toBeTruthy();
  expect(outcome().querySelector(".experience-line")?.textContent).not.toBe(line);
  tick(9999);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  tick(1);
  const ultimate = screen.getByRole("alertdialog", { name: "웹 체험 안뇽이 궁극기" });
  expect(within(ultimate).getByText("웹 체험 · 시뮬레이션")).toBeTruthy();
  expect(within(ultimate).getByRole("img", { name: "안뇽이 궁극기" })).toBeTruthy();
  fireEvent.click(within(ultimate).getByRole("button", { name: "돌아갈게..." }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(within(outcome()).getByText("집중으로 돌아왔어요")).toBeTruthy();
  expect(within(outcome()).getByText("물리학 실험 보고서 작성")).toBeTruthy();
  tick(100_000);
  expect(vi.getTimerCount()).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
});

it("uses the preview stage control for inactivity and records a local correction", () => {
  start();
  choose("inactivity");
  expect(screen.getByText(/책을 읽거나 손으로 문제를/)).toBeTruthy();
  for (let count = 0; count < 3; count++) fireEvent.click(button("다음 개입 단계"));
  const ultimate = screen.getByRole("alertdialog");
  fireEvent.click(within(ultimate).getByRole("button", { name: "공부 중인데?" }));
  expect(within(outcome()).getByText("판단을 정정했어요")).toBeTruthy();
  expect(poolFor({ tone: "default", group: "study", stage: 1 })).toContain(outcome().querySelector(".experience-line")?.textContent);
  expect(vi.getTimerCount()).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps the experience tone local and renders the reviewed title substitution", () => {
  vi.spyOn(Math, "random").mockReturnValue(0);
  localStorage.setItem("mobonyong.tone", "hardcore");
  localStorage.setItem("mobonyong.ai-consent", "1");
  const view = start();
  choose("game");
  fireEvent.click(button("다음 개입 단계"));
  const line = () => outcome().querySelector(".experience-line")?.textContent ?? "";
  expect(line()).toContain("「롤 하이라이트 모음」도 시험 범위야?");
  expect(profanity.test(line())).toBe(false);
  fireEvent.click(screen.getByRole("radio", { name: /하드코어 · 강한 욕설/ }));
  expect(line()).toContain("시발ㅋㅋ 「롤 하이라이트 모음」");
  fireEvent.click(screen.getByRole("radio", { name: /기본 · 욕설 없는/ }));
  expect(profanity.test(line())).toBe(false);
  fireEvent.click(button("다시 체험하기"));
  expect(screen.getByLabelText("체험용 할 일")).toBeTruthy();
  tick(20);
  expect(vi.getTimerCount()).toBe(0);
  view.unmount();
  const fresh = render(<WebExperience initialTask="" onExit={vi.fn()} />);
  expect((screen.getByLabelText("체험용 할 일") as HTMLInputElement).value).toBe("");
  expect(localStorage.getItem("mobonyong.tone")).toBe("hardcore");
  expect(localStorage.getItem("mobonyong.ai-consent")).toBe("1");
  fresh.unmount();
});

it("discards prior observations after a scenario change and clears the timer on exit", () => {
  const view = start();
  choose("game");
  tick(9000);
  choose("unrelated");
  tick(1000);
  expect(within(outcome()).getByText("체험 관측 중")).toBeTruthy();
  expect(vi.getTimerCount()).toBe(1);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
});
