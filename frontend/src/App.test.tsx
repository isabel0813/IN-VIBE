import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { sessionStore } from "./session/store";
import * as desktop from "./desktop/bridge";

let requests: { path: string; method: string; body: Record<string, unknown> | null }[];
beforeEach(async () => {
  await sessionStore.send({ type: "end" });
  localStorage.clear();
  requests = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(String(init.body)) : null;
    requests.push({ path, method: init.method ?? "GET", body });
    if (path === "/sessions") return Response.json({ id: 17, task: body.task }, { status: 201 });
    if (path === "/sessions/17/end") return Response.json({ active: false });
    throw new Error(`Unexpected API in the focus flow: ${path}`);
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function openSettings() {
  fireEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
  fireEvent.click(screen.getByRole("button", { name: "감지·AI 설정" }));
}
function backToFocus() {
  fireEvent.click(screen.getByRole("button", { name: "집중 화면으로 돌아가기" }));
}
function fill(task = "전자기 유도 공부") {
  fireEvent.change(screen.getByLabelText("지금 공부할 일"), { target: { value: task } });
}
async function start() {
  fill();
  fireEvent.click(screen.getByRole("button", { name: "집중 시작" }));
  await screen.findByRole("button", { name: "세션 종료" });
}

describe("C landing one-line focus flow", () => {
  it("opens and ends the local web experience during an existing session without mutating it", async () => {
    render(<App />);
    await start();
    const active = sessionStore.getSnapshot().session;
    fireEvent.click(screen.getByRole("button", { name: "웹에서 체험하기" }));
    const input = await screen.findByLabelText("체험용 할 일");
    fireEvent.change(input, { target: { value: "체험 목표" } });
    fireEvent.click(screen.getByRole("button", { name: "체험 시작" }));
    fireEvent.change(screen.getByLabelText("가상의 활동 선택"), { target: { value: "game" } });
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "다음 개입 단계" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "체험 종료" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("heading", { name: "지금 집중하는 목표" })).toBeTruthy();
    expect(sessionStore.getSnapshot().session).toEqual(active);
    expect(requests).toEqual([{ path: "/sessions", method: "POST", body: { task: "전자기 유도 공부" } }]);
  });
  it("shows the install path on web and hides the web-only actions on desktop", () => {
    const web = render(<App />);
    expect(screen.getByRole("link", { name: "실제 사용하기" }).getAttribute("href")).toBe("/install.html");
    web.unmount();
    vi.spyOn(desktop, "isDesktop").mockReturnValue(true);
    render(<App />);
    expect(screen.queryByRole("button", { name: "웹에서 체험하기" })).toBeNull();
    expect(screen.queryByRole("link", { name: "실제 사용하기" })).toBeNull();
  });
  it("persists the opt-in tone across app remounts", () => {
    const view = render(<App />);
    openSettings();
    fireEvent.click(screen.getByRole("radio", { name: /하드코어/ }));
    expect(localStorage.getItem("mobonyong.tone")).toBe("hardcore");
    view.unmount();
    render(<App />);
    openSettings();
    expect(screen.getByRole<HTMLInputElement>("radio", { name: /하드코어/ }).checked).toBe(true);
  });
  it("opens the clean menu without exposing planner actions or making API requests", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
    const menu = screen.getByRole("complementary", { name: "메뉴" });
    expect(within(menu).getByRole("button", { name: "감지·AI 설정" })).toBeTruthy();
    expect(within(menu).queryByRole("button", { name: "집중 화면" })).toBeNull();
    expect(within(menu).queryByText(/나의 계획|할 일 정리|여유 시간/)).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "메뉴" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("starts without task/plan/settings queries or AI parsing and without consent", async () => {
    const widget = vi.spyOn(desktop, "showWidget");
    render(<App />);
    expect(screen.getByRole("heading", { name: "오늘 끝낼 일은?" })).toBeTruthy();
    expect(screen.getByText("자세히 적을수록 안뇽이가 더 잘 알아볼 수 있어!")).toBeTruthy();
    expect(screen.getByPlaceholderText("예: 물리학2 패러데이 법칙 공부하기")).toBeTruthy();
    expect((screen.getByLabelText("지금 공부할 일") as HTMLInputElement).type).toBe("text");
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "AI로 할 일 정리" })).toBeNull();
    await start();
    expect(requests).toEqual([{ path: "/sessions", method: "POST", body: { task: "전자기 유도 공부" } }]);
    expect(widget).toHaveBeenCalledWith(true);
    expect(sessionStore.getSnapshot().session).toMatchObject({ running: true, task: { id: 1_000_000_000_017, name: "전자기 유도 공부" } });
    expect(screen.getByLabelText("안뇽이 웹 미리보기")).toBeTruthy();
  });
  it("keeps whitespace-only input disabled and trims the submitted task", async () => {
    render(<App />); fill("   ");
    expect((screen.getByRole("button", { name: "집중 시작" }) as HTMLButtonElement).disabled).toBe(true);
    fill("  전자기 유도 공부  ");
    fireEvent.click(screen.getByRole("button", { name: "집중 시작" }));
    await screen.findByRole("button", { name: "세션 종료" });
    expect(requests[0].body).toEqual({ task: "전자기 유도 공부" });
  });
  it("creates only one session across rapid submit and settings navigation", async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<App />); fill();
    const form = screen.getByLabelText("지금 공부할 일").closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form);
    openSettings();
    backToFocus();
    fireEvent.submit(form);
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => finish(Response.json({ id: 17, task: "전자기 유도 공부" })));
    await screen.findByRole("button", { name: "세션 종료" });
    fireEvent.submit(form);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps input on a failed server start and never opens a widget", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({}, { status: 500 }));
    const widget = vi.spyOn(desktop, "showWidget");
    render(<App />); fill();
    fireEvent.click(screen.getByRole("button", { name: "집중 시작" }));
    await screen.findByRole("alert");
    expect(widget).not.toHaveBeenCalled();
    expect(sessionStore.getSnapshot().session.running).toBe(false);
    expect((screen.getByLabelText("지금 공부할 일") as HTMLInputElement).value).toBe("전자기 유도 공부");
  });
  it("can retry showing the widget without creating a second server session", async () => {
    const widget = vi.spyOn(desktop, "showWidget").mockRejectedValueOnce(new Error("window failed"));
    render(<App />); await start();
    await screen.findByRole("alert");
    widget.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole("button", { name: "위젯 미리보기" }));
    await waitFor(() => expect(widget).toHaveBeenCalledTimes(2));
    expect(requests.filter(r => r.path === "/sessions")).toHaveLength(1);
  });
  it("shares task and pause/end state with the widget and terminates the server session once", async () => {
    render(<App />); await start();
    fireEvent.click(screen.getByRole("button", { name: /^안뇽이:/ }));
    expect(within(screen.getByRole("dialog", { name: "안뇽이 말풍선" })).getByText("전자기 유도 공부")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "일시정지" }));
    fireEvent.click(screen.getByRole("button", { name: "쉬기 시작" }));
    await waitFor(() => expect(sessionStore.getSnapshot().session.paused).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "재개" }));
    await waitFor(() => expect(sessionStore.getSnapshot().session.paused).toBe(false));
    const end = screen.getByRole("button", { name: "종료" });
    await waitFor(() => expect((end as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(end);
    await waitFor(() => expect(requests.filter(r => r.path === "/sessions/17/end")).toHaveLength(1));
    expect(sessionStore.getSnapshot().session.running).toBe(false);
    expect(localStorage.getItem("mobonyong.cloud-session")).toBeNull();
    expect(requests.every(r => r.path.startsWith("/sessions"))).toBe(true);
  });
  it("keeps AI consent explicit and remembers it after reopening the app", async () => {
    render(<App />); fill();
    openSettings();
    const consent = screen.getByRole("checkbox", { name: /AI 판단에 동의합니다/ }) as HTMLInputElement;
    expect(consent.checked).toBe(false);
    fireEvent.click(consent);
    backToFocus();
    expect((screen.getByLabelText("지금 공부할 일") as HTMLInputElement).value).toBe("전자기 유도 공부");
    openSettings();
    expect((screen.getByRole("checkbox", { name: /AI 판단에 동의합니다/ }) as HTMLInputElement).checked).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    cleanup();
    render(<App />); openSettings();
    const again = screen.getByRole("checkbox", { name: /AI 판단에 동의합니다/ }) as HTMLInputElement;
    expect(again.checked).toBe(true);
    fireEvent.click(again);
    cleanup();
    render(<App />); openSettings();
    expect((screen.getByRole("checkbox", { name: /AI 판단에 동의합니다/ }) as HTMLInputElement).checked).toBe(false);
  });
  it("ends from the main screen without requesting legacy plan data", async () => {
    render(<App />); await start();
    fireEvent.click(screen.getByRole("button", { name: "세션 종료" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].path).toBe("/sessions/17/end");
    expect(sessionStore.getSnapshot().session.running).toBe(false);
  });
  it("changes the task of a running session from the main screen", async () => {
    render(<App />); await start();
    fireEvent.click(screen.getByRole("button", { name: "할 일 바꾸기" }));
    const input = screen.getByLabelText("지금 공부할 일") as HTMLInputElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    expect(input.value).toBe("전자기 유도 공부");
    fireEvent.change(input, { target: { value: "자기장 공부" } });
    fireEvent.click(screen.getByRole("button", { name: "할 일 바꾸기" }));
    await waitFor(() => expect(requests.filter(r => r.path === "/sessions")).toHaveLength(2));
    expect(requests.filter(r => r.path === "/sessions")[1].body).toEqual({ task: "자기장 공부" });
    await waitFor(() => expect(sessionStore.getSnapshot().session.task?.name).toBe("자기장 공부"));
    expect(sessionStore.getSnapshot().session.running).toBe(true);
  });
  it("does not resume a stored cloud session on relaunch", () => {
    localStorage.setItem("mobonyong.cloud-session", JSON.stringify({ id: 17, task: "이전 작업", ask: null, reason: "" }));
    render(<App />);
    expect(localStorage.getItem("mobonyong.cloud-session")).toBeNull();
    expect(sessionStore.getSnapshot().session.running).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("loads preserved task data only after explicitly opening the legacy screen", async () => {
    render(<App />);
    openSettings();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("기존 작업 데이터"));
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      requests.push({ path, method: "GET", body: null });
      if (path === "/tasks") return Response.json([]);
      if (path === "/settings") return Response.json({ daily_minutes: 480 });
      if (path === "/plan") return Response.json({ now: "2026-11-15T12:00:00+09:00", status: "ok", now_task: null, order: [], overdue: [], free_minutes: null, start_by: null });
      throw new Error(path);
    });
    fireEvent.click(screen.getByRole("button", { name: "기존 작업 보기" }));
    await screen.findByLabelText("어떤 일을 해야 하나요?");
    expect(requests.map(r => r.path).sort()).toEqual(["/plan", "/settings", "/tasks"]);
    fireEvent.click(screen.getByRole("button", { name: "한 줄 집중 화면으로" }));
    expect(screen.getByLabelText("지금 공부할 일")).toBeTruthy();
    expect(requests).toHaveLength(3);
  });
});
