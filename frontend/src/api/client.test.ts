import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, getUserId, USER_ID_KEY } from "./client";

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("API transport", () => {
  it("sends only confirmed minutes to recovery, without advancing time or exposing window metadata", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await api.wasted(5);
    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe("/plan/wasted");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ wasted_minutes: 5 });
    expect(fetchMock.mock.calls[0][1].headers["X-User-Id"]).toBe(getUserId());
    for (const minutes of [-1, 1.5, 1441, NaN]) await expect(api.wasted(minutes)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("persists a UUID across calls and supplies it to every required endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    fetchMock.mockImplementation(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const id = getUserId();
    expect(getUserId()).toBe(id);
    expect(localStorage.getItem(USER_ID_KEY)).toBe(id);
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
    await api.tasks();
    await api.plan();
    await api.settings();
    await api.parse("발표 준비");
    await api.createBatch([
      {
        name: "발표 준비",
        deadline: "2026-11-12T18:00:00+09:00",
        important: true,
        estimated_minutes: 60,
      },
    ]);
    await api.updateTask(7, { done: true });
    expect(
      fetchMock.mock.calls.map((call) => new URL(call[0]).pathname),
    ).toEqual([
      "/tasks",
      "/plan",
      "/settings",
      "/tasks/parse",
      "/tasks/batch",
      "/tasks/7",
    ]);
    for (const [, options] of fetchMock.mock.calls)
      expect(options.headers["X-User-Id"]).toBe(id);
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({
      text: "발표 준비",
    });
    expect(JSON.parse(fetchMock.mock.calls[4][1].body).tasks).toHaveLength(1);
    expect(JSON.parse(fetchMock.mock.calls[5][1].body)).toEqual({ done: true });
  });
  it.each([422, 503])(
    "gives a manual-entry fallback message on parse status %s",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("{}", { status })),
      );
      await expect(api.parse("할 일")).rejects.toThrow("직접 입력");
    },
  );
  it("reports network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    await expect(api.tasks()).rejects.toThrow("서버에 연결할 수 없어요");
  });
  it("reports blocked storage instead of silently changing users", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => getUserId()).toThrow("로컬 저장소");
  });
  it("aborts a stalled ordinary request", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, options: RequestInit) =>
          new Promise((_resolve, reject) =>
            options.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            ),
          ),
      ),
    );
    const request = expect(api.tasks()).rejects.toThrow("응답을 기다리는 시간");
    await vi.advanceTimersByTimeAsync(15000);
    await request;
  });
});
