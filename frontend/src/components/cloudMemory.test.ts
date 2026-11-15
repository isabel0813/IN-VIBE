import { beforeEach, expect, it, vi } from "vitest";
import { createCloudMemory, removeLegacyCloudData } from "./cloudMemory";
import type { MemoryPort, CloudState } from "./cloudMemory";
const video = { title: "[합성] 전자기 유도 강의", video_id: "abcdefghijk" };
const value: CloudState = { id: 1, task: "물리 공부", ask: video, reason: "합성 이유" };
function network() {
  const ports: MemoryPort[] = [];
  return () => {
    const port: MemoryPort = { onmessage: null, postMessage(message) {
      for (const peer of ports) if (peer !== port) {
        const data = structuredClone(message);
        queueMicrotask(() => peer.onmessage?.(new MessageEvent("message", { data })));
      }
    } };
    ports.push(port);
    return port;
  };
}
beforeEach(() => localStorage.clear());
it("synchronizes live video data to a late widget without persistent writes", async () => {
  const write = vi.spyOn(Storage.prototype, "setItem");
  const port = network();
  const main = createCloudMemory(true, port());
  main.set(value);
  const widget = createCloudMemory(false, port());
  await widget.refresh();
  expect(widget.read()).toEqual(value);
  expect(write).not.toHaveBeenCalled();
  write.mockRestore();
});
it("acknowledges correction before another view reads and retains only session IDs", async () => {
  const port = network();
  const main = createCloudMemory(true, port());
  const widget = createCloudMemory(false, port());
  main.set(value);
  await widget.refresh();
  await widget.dismiss(1, video.video_id);
  expect(main.read()?.ask).toBeNull();
  expect(widget.dismissed()).toEqual([video.video_id]);
  const other = { title: "다른 합성 영상", video_id: "zyxwvutsrqp" };
  main.set({ ...value, ask: other });
  await widget.dismiss(1, video.video_id);
  expect(widget.read()?.ask).toEqual(other);
  expect(widget.dismissed()).toEqual([video.video_id]);
});
it("clears main and widget snapshots and corrections at session end", async () => {
  const port = network();
  const main = createCloudMemory(true, port());
  const widget = createCloudMemory(false, port());
  main.set(value);
  await widget.dismiss(1, video.video_id);
  main.set(null);
  await widget.refresh();
  expect(widget.read()).toBeNull();
  expect(widget.dismissed()).toEqual([]);
});
it("rejects old-session dismissal and starts new sessions without previous correction IDs", async () => {
  const main = createCloudMemory(true);
  main.set(value);
  await main.dismiss(1, video.video_id);
  main.set({ ...value, id: 2 });
  await main.dismiss(1, video.video_id);
  expect(main.read()?.ask).toEqual(video);
  expect(main.dismissed()).toEqual([]);
});
it("new process memory is empty and obsolete activity keys are removed without touching preferences", () => {
  localStorage.setItem("mobonyong.cloud-session", JSON.stringify(value));
  localStorage.setItem("mobonyong.cloud-session.dismissed", JSON.stringify({ id: 1, videos: [video.video_id] }));
  localStorage.setItem("in-vibe.user-id", "existing-user");
  localStorage.setItem("user-preferences", "keep");
  const restarted = createCloudMemory(true);
  expect(restarted.read()).toBeNull();
  removeLegacyCloudData();
  expect(localStorage.getItem("mobonyong.cloud-session")).toBeNull();
  expect(localStorage.getItem("mobonyong.cloud-session.dismissed")).toBeNull();
  expect(localStorage.getItem("in-vibe.user-id")).toBe("existing-user");
  expect(localStorage.getItem("user-preferences")).toBe("keep");
});
it("owner reset clears an already-open widget on main reload", async () => {
  const port = network();
  const main = createCloudMemory(true, port());
  const widget = createCloudMemory(false, port());
  main.set(value);
  await widget.refresh();
  main.reset();
  await widget.refresh();
  expect(widget.read()).toBeNull();
  expect(widget.dismissed()).toEqual([]);
});
it("a view without a memory channel fails explicitly instead of persisting activity", async () => {
  const widget = createCloudMemory(false);
  await expect(widget.refresh()).rejects.toThrow("메모리 동기화");
  expect(localStorage.length).toBe(0);
});
it("reports failure to remove legacy activity when storage access is blocked", () => {
  const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
  try { expect(removeLegacyCloudData()).toBe(false); }
  finally { remove.mockRestore(); }
});
