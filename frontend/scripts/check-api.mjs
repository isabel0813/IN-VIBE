// Live FastAPI contract check with a fresh test-only user. No existing task is changed.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const base = process.env.VITE_API_BASE_URL || "http://127.0.0.1:8010";
const user = randomUUID();
const created = [];
async function request(path, method = "GET", body) {
  const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", "X-User-Id": user },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  assert.ok(response.ok, `${method} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}
try {
  assert.deepEqual(await request("/health"), { ok: true });
  assert.ok((await request("/settings")).daily_minutes > 0);
  const tasks = await request("/tasks/batch", "POST", { tasks: [{ name: "[자동 통합 테스트] 계획 복구", deadline: "2030-01-10T13:30:00+09:00", estimated_minutes: 60, important: false }] });
  created.push(...tasks.map(task => task.id));
  assert.equal((await request("/tasks")).length, 1);
  const now = "2030-01-10T12:00:00+09:00";
  const plan = await request("/plan?now=" + encodeURIComponent(now));
  const recovery = await request("/plan/wasted", "POST", { wasted_minutes: 60, now });
  assert.deepEqual(recovery.plan, plan, "elapsed time must not be deducted twice");
  assert.equal(recovery.plan.free_minutes, 30);
  assert.equal(recovery.plan.now_task.task_id, tasks[0].id);
  const live = await request("/plan/wasted", "POST", { wasted_minutes: 0 });
  assert.ok(Math.abs(Date.parse(live.plan.now) - Date.now()) < 60_000, "omitted now uses server current time");
  await request(`/tasks/${tasks[0].id}`, "PATCH", { done: true });
  assert.equal((await request("/plan")).now_task, null);
  console.log("PASS: live health, settings, batch, tasks, PATCH, plan, wasted; no double subtraction; server clock");
} finally {
  for (const id of created) await request(`/tasks/${id}`, "DELETE");
  console.log("Test-only tasks cleaned up; no existing user data changed.");
}
