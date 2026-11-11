import type { ParsedTasks, Plan, Settings, Task, TaskDraft } from "./types";

export const USER_ID_KEY = "in-vibe.user-id";
const baseUrl = (
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8010"
).replace(/\/+$/, "");

export function getUserId(): string {
  try {
    const saved = localStorage.getItem(USER_ID_KEY);
    if (
      saved &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        saved,
      )
    )
      return saved;
    const id = crypto.randomUUID();
    localStorage.setItem(USER_ID_KEY, id);
    return id;
  } catch {
    throw new Error(
      "사용자 정보를 저장할 수 없어요. 브라우저의 로컬 저장소를 허용한 뒤 다시 시도해 주세요.",
    );
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<T> {
  const id = getUserId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  if (init.signal?.aborted) controller.abort();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init.headers,
        "X-User-Id": id,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const message =
        path === "/tasks/parse"
          ? "AI가 할 일을 정리하지 못했어요. 직접 입력으로 계속할 수 있어요."
          : response.status === 422
            ? "입력한 이름, 마감, 예상 시간을 확인해 주세요."
            : response.status === 404
              ? "작업을 찾을 수 없어요. 계획을 새로고침해 주세요."
              : "서버에서 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
      throw new ApiError(response.status, message);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted)
      throw new Error(
        "응답을 기다리는 시간이 길어졌어요. 다시 시도하거나 직접 입력해 주세요.",
      );
    throw new Error(
      "서버에 연결할 수 없어요. 백엔드 실행 상태와 연결 주소를 확인해 주세요.",
    );
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}

export const api = {
  parse: (text: string, signal?: AbortSignal) =>
    request<ParsedTasks>(
      "/tasks/parse",
      { method: "POST", body: JSON.stringify({ text }), signal },
      130000,
    ),
  createBatch: (tasks: TaskDraft[]) =>
    request<Task[]>("/tasks/batch", {
      method: "POST",
      body: JSON.stringify({ tasks }),
    }),
  tasks: () => request<Task[]>("/tasks"),
  updateTask: (id: number, patch: Partial<TaskDraft> & { done?: boolean }) =>
    request<Task>(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  plan: () => request<Plan>("/plan"),
  settings: () => request<Settings>("/settings"),
};
