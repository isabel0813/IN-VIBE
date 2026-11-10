import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import type { Plan, Task } from "./api/types";

const draft = {
  name: "발표 준비",
  deadline: "2026-11-12T18:00:00+09:00",
  important: true,
  estimated_minutes: 120,
};
let tasks: Task[];
let parseStatus: number;
let batchStatus: number;
let failRefresh: boolean;
let failPatch: boolean;
let requests: {
  path: string;
  method: string;
  body: Record<string, unknown> | null;
}[];
const planFor = (): Plan => {
  const order = tasks
    .filter((task) => !task.done)
    .map((task) => ({
      ...task,
      task_id: task.id,
      minutes_until_deadline: 180,
      assigned_minutes: 120,
      short_minutes: 0,
    }));
  return {
    now: "2026-11-12T15:00:00+09:00",
    status: "ok",
    now_task: order[0] ?? null,
    order,
    free_minutes: order.length ? 60 : null,
    start_by: order.length ? "2026-11-12T16:00:00+09:00" : null,
    overdue: [],
  };
};

beforeEach(() => {
  localStorage.clear();
  tasks = [];
  parseStatus = 200;
  batchStatus = 201;
  failRefresh = false;
  failPatch = false;
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: RequestInit = {}) => {
      const path = new URL(url).pathname;
      const method = options.method ?? "GET";
      const body = options.body ? JSON.parse(String(options.body)) : null;
      requests.push({ path, method, body });
      if (failRefresh && method === "GET") throw new TypeError("offline");
      if (path === "/tasks/parse")
        return new Response(
          JSON.stringify({
            drafts: [draft],
            assumptions: ["발표 준비: 2시간으로 추정"],
          }),
          { status: parseStatus },
        );
      if (path === "/tasks/batch") {
        if (batchStatus !== 201)
          return new Response("{}", { status: batchStatus });
        const created = body.tasks.map((item: typeof draft, index: number) => ({
          ...item,
          id: tasks.length + index + 1,
          done: false,
          done_at: null,
        }));
        tasks = [...tasks, ...created];
        return Response.json(created, { status: 201 });
      }
      if (method === "PATCH") {
        if (failPatch) return new Response("{}", { status: 500 });
        const id = Number(path.split("/").pop());
        tasks = tasks.map((task) =>
          task.id === id ? { ...task, ...body } : task,
        );
        return Response.json(tasks.find((task) => task.id === id));
      }
      if (path === "/tasks") return Response.json(tasks);
      if (path === "/plan") return Response.json(planFor());
      if (path === "/settings") return Response.json({ daily_minutes: 480 });
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function openInput() {
  render(<App />);
  await screen.findByLabelText("어떤 일을 해야 하나요?");
}
async function parseDraft() {
  await openInput();
  fireEvent.change(screen.getByLabelText("어떤 일을 해야 하나요?"), {
    target: { value: "발표 준비 내일 6시까지" },
  });
  fireEvent.click(screen.getByRole("button", { name: "AI로 할 일 정리" }));
  await screen.findByLabelText("작업 이름");
}

describe("Phase 1 user flows", () => {
  it("parses, reviews assumptions, edits, saves, starts, completes and restores a task", async () => {
    await parseDraft();
    expect(screen.getByText("발표 준비: 2시간으로 추정")).toBeTruthy();
    expect(requests.some((request) => request.path === "/tasks/batch")).toBe(
      false,
    );
    fireEvent.change(screen.getByLabelText("작업 이름"), {
      target: { value: "최종 발표 준비" },
    });
    fireEvent.change(screen.getByLabelText("예상 소요시간 (분)"), {
      target: { value: "90" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장하고 계획 보기" }));
    const start = await screen.findByRole("button", { name: "작업 시작" });
    await waitFor(() =>
      expect((start as HTMLButtonElement).disabled).toBe(false),
    );
    expect(tasks[0]).toMatchObject({
      name: "최종 발표 준비",
      estimated_minutes: 90,
      deadline: "2026-11-12T18:00:00+09:00",
    });
    fireEvent.click(start);
    expect(screen.getByText("지금은, 이 일에 집중해요.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "작업 완료" }));
    await screen.findByText("등록한 일을 모두 마쳤어요.");
    const checkbox = screen.getByRole("checkbox", {
      name: "최종 발표 준비 완료",
    }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    await waitFor(() => expect(checkbox.disabled).toBe(false));
    fireEvent.click(checkbox);
    await screen.findByRole("button", { name: "작업 시작" });
    expect(tasks[0].done).toBe(false);
    expect(screen.getByText(/하루 8시간/)).toBeTruthy();
  });
  it.each([422, 503])(
    "falls back to manual entry on AI %s without losing the original text",
    async (status) => {
      parseStatus = status;
      await parseDraft();
      expect(screen.getByText(/AI가 할 일을 정리하지 못했어요/)).toBeTruthy();
      expect(screen.getByText("발표 준비 내일 6시까지")).toBeTruthy();
      fireEvent.change(screen.getByLabelText("작업 이름"), {
        target: { value: "직접 입력한 일" },
      });
      fireEvent.change(screen.getByLabelText("마감 시간 (한국 시간)"), {
        target: { value: "2026-11-13T15:00" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "저장하고 계획 보기" }),
      );
      await screen.findByRole("button", { name: "작업 시작" });
      expect(tasks[0].name).toBe("직접 입력한 일");
    },
  );
  it("supports manual entry without invoking AI, including adding and removing draft rows", async () => {
    await openInput();
    fireEvent.click(screen.getByRole("button", { name: /직접 입력하기/ }));
    fireEvent.click(screen.getByRole("button", { name: /작업 추가/ }));
    expect(screen.getAllByLabelText("작업 이름")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "1번째 작업 삭제" }));
    expect(screen.getAllByLabelText("작업 이름")).toHaveLength(1);
    expect(requests.some((request) => request.path === "/tasks/parse")).toBe(
      false,
    );
  });
  it("retains editable drafts after failed save and succeeds on retry", async () => {
    batchStatus = 500;
    await parseDraft();
    fireEvent.click(screen.getByRole("button", { name: "저장하고 계획 보기" }));
    await screen.findByText(/서버에서 요청을 처리하지 못했어요/);
    expect((screen.getByLabelText("작업 이름") as HTMLInputElement).value).toBe(
      "발표 준비",
    );
    batchStatus = 201;
    fireEvent.click(screen.getByRole("button", { name: "저장하고 계획 보기" }));
    await screen.findByRole("button", { name: "작업 시작" });
    expect(tasks).toHaveLength(1);
  });
  it("does not resubmit a saved batch when subsequent plan refresh fails", async () => {
    await parseDraft();
    failRefresh = true;
    fireEvent.click(screen.getByRole("button", { name: "저장하고 계획 보기" }));
    await screen.findByText("계획을 불러오지 못했어요.");
    expect(tasks).toHaveLength(1);
    failRefresh = false;
    fireEvent.click(screen.getByRole("button", { name: "다시 연결" }));
    await screen.findByRole("button", { name: "작업 시작" });
    expect(
      requests.filter((request) => request.path === "/tasks/batch"),
    ).toHaveLength(1);
  });
  it("edits an existing task through PATCH and keeps completion unchanged after a failed PATCH", async () => {
    tasks = [{ ...draft, id: 1, done: false, done_at: null }];
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "발표 준비 수정" }),
    );
    fireEvent.change(screen.getByLabelText("예상 소요시간 (분)"), {
      target: { value: "45" },
    });
    fireEvent.click(screen.getByRole("button", { name: "수정하고 계획 보기" }));
    await screen.findByRole("button", { name: "작업 시작" });
    expect(tasks[0].estimated_minutes).toBe(45);
    failPatch = true;
    const checkbox = screen.getByRole("checkbox", {
      name: "발표 준비 완료",
    }) as HTMLInputElement;
    await waitFor(() => expect(checkbox.disabled).toBe(false));
    fireEvent.click(checkbox);
    await screen.findByText(/서버에서 요청을 처리하지 못했어요/);
    expect(checkbox.checked).toBe(false);
  });
  it("keeps manual input available when the backend is offline", async () => {
    failRefresh = true;
    await openInput();
    expect(screen.getByRole("alert").textContent).toContain(
      "서버에 연결할 수 없어요",
    );
    fireEvent.click(screen.getByRole("button", { name: /직접 입력하기/ }));
    expect(screen.getByLabelText("작업 이름")).toBeTruthy();
  });

  it("lets users leave a slow AI request and ignores its late response", async () => {
    await openInput();
    let resolveParse!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveParse = resolve;
        }),
    );
    fireEvent.change(screen.getByLabelText("어떤 일을 해야 하나요?"), {
      target: { value: "기다리는 작업" },
    });
    fireEvent.click(screen.getByRole("button", { name: "AI로 할 일 정리" }));
    expect(screen.getByText("정리하는 중…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /직접 입력하기/ }));
    fireEvent.change(screen.getByLabelText("작업 이름"), {
      target: { value: "직접 쓴 초안" },
    });
    resolveParse(Response.json({ drafts: [draft], assumptions: [] }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("작업 이름") as HTMLInputElement).value,
      ).toBe("직접 쓴 초안"),
    );
    expect(screen.queryByText("발표 준비: 2시간으로 추정")).toBeNull();
  });
});
