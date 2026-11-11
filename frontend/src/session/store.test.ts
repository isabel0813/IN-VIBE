import { describe, expect, it, vi } from "vitest";
import { createSessionStore } from "./store";
import { emptySession, reduceSession } from "./model";
import type { FocusSession, SessionAction } from "./model";

describe("multi-window session synchronization", () => {
  it("shares mutations across separate stores and rejects out-of-order snapshots", async () => {
    let state = emptySession();
    const callbacks = new Set<(value: FocusSession) => void>();
    const transport = {
      read: async () => state,
      send: async (action: SessionAction) => {
        state = reduceSession(state, action);
        callbacks.forEach((fn) => fn(state));
        return state;
      },
      listen: async (callback: (value: FocusSession) => void) => {
        callbacks.add(callback);
        return () => {
          callbacks.delete(callback);
        };
      },
    };
    const main = createSessionStore(transport),
      widget = createSessionStore(transport);
    const stopMain = main.subscribe(vi.fn()),
      stopWidget = widget.subscribe(vi.fn());
    await vi.waitFor(() =>
      expect(main.getSnapshot().ready && widget.getSnapshot().ready).toBe(true),
    );
    await main.send({
      type: "start",
      task: { id: 5, name: "실제 선택한 작업" },
    });
    await widget.send({ type: "pause" });
    expect(main.getSnapshot().session).toEqual(widget.getSnapshot().session);
    expect(main.getSnapshot().session.paused).toBe(true);
    callbacks.forEach((fn) => fn(emptySession()));
    expect(main.getSnapshot().session.paused).toBe(true);
    await widget.send({ type: "end" });
    expect(main.getSnapshot().session.running).toBe(false);
    stopMain();
    stopWidget();
    expect(callbacks.size).toBe(0);
  });
  it("does not overwrite a live event with a stale initial read", async () => {
    let deliver!: (state: FocusSession) => void;
    let resolveRead!: (state: FocusSession) => void;
    const store = createSessionStore({
      read: () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
      send: async () => emptySession(),
      listen: async (callback) => {
        deliver = callback;
        return () => {};
      },
    });
    const stop = store.subscribe(vi.fn());
    await vi.waitFor(() => expect(resolveRead).toBeTypeOf("function"));
    deliver({
      ...emptySession(),
      revision: 4,
      running: true,
      task: { id: 9, name: "새 작업" },
      startedAt: 100,
    });
    resolveRead(emptySession());
    await Promise.resolve();
    expect(store.getSnapshot().session.revision).toBe(4);
    stop();
  });
  it("removes a listener even if mounting is cancelled before registration resolves", async () => {
    let register!: (dispose: () => void) => void;
    const unlisten = vi.fn();
    const store = createSessionStore({
      read: async () => emptySession(),
      send: async () => emptySession(),
      listen: () =>
        new Promise((resolve) => {
          register = resolve;
        }),
    });
    store.subscribe(vi.fn())();
    register(unlisten);
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledOnce());
  });
});
