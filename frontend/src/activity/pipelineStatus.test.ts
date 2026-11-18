import { expect, it } from "vitest";
import { activityStatus, browserStatus } from "./pipelineStatus";
const session = { running: true, paused: false, task: { id: 1_000_000_000_023 } };
const browser = { consent: true, connected: true, collecting: true, observing: true };
it("does not mislabel a cloud session with monitoring=false as waiting", () => {
  expect(activityStatus(true, false, "미분류", session, true)).toContain("로컬 이탈 판단 제외");
});
it("distinguishes stopped, paused and not-yet-synchronized sessions", () => {
  expect(activityStatus(true, false, "", { ...session, running: false }, true)).toBe("세션 대기");
  expect(activityStatus(true, false, "", { ...session, paused: true }, true)).toBe("일시정지");
  expect(activityStatus(true, false, "", session, false)).toBe("세션 상태 확인 중");
});
it("retains native monitoring categories without claiming monitoring when stopped", () => {
  const local = { ...session, task: { id: 3 } };
  expect(activityStatus(true, true, "관련 활동", local, true)).toBe("관련 활동");
  expect(activityStatus(true, false, "관련 활동", local, true)).toBe("관측 상태 확인 중");
  expect(activityStatus(false, true, "", session, true)).toBe("꺼짐");
});
it("identifies consent gates before reporting playback", () => {
  expect(browserStatus(false, browser, session, true)).toContain("Windows 활동 감지 동의");
  expect(browserStatus(true, { ...browser, consent: false }, session, true)).toContain("YouTube 로컬 관측 동의");
});
it("separates idle, pause, host disconnect, collecting failure and playback", () => {
  expect(browserStatus(true, browser, { ...session, running: false }, true)).toContain("세션 시작 대기");
  expect(browserStatus(true, browser, { ...session, paused: true }, true)).toContain("일시정지");
  expect(browserStatus(true, { ...browser, connected: false }, session, true)).toContain("Native Host 연결 대기");
  expect(browserStatus(true, { ...browser, collecting: false }, session, true)).toContain("수집 준비 확인 필요");
  expect(browserStatus(true, { ...browser, observing: false }, session, true)).toContain("영상 대기");
  expect(browserStatus(true, browser, session, true)).toContain("영상 재생 관측 중");
});
