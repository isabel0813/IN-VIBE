import { describe, expect, it } from "vitest";
import { characterStates, emptySession, reduceSession } from "./model";

const task = { id: 42, name: "발표 준비" };
describe("focus session invariants", () => {
  it("starts with a task, pauses, resumes without resetting time, and ends", () => {
    let session = reduceSession(emptySession(), { type: "start", task }, 100);
    expect(session).toMatchObject({
      task,
      startedAt: 100,
      running: true,
      paused: false,
      character: "focus",
    });
    session = reduceSession(session, { type: "pause" }, 200);
    expect(session).toMatchObject({ paused: true, running: true });
    session = reduceSession(session, { type: "resume" }, 300);
    expect(session).toMatchObject({ startedAt: 100, paused: false });
    session = reduceSession(session, { type: "end" });
    expect(session).toMatchObject({
      task: null,
      running: false,
      startedAt: null,
      character: "idle",
    });
    expect(emptySession().running).toBe(false);
  });
  it("only completes the matching task, retaining its identity for the completion message", () => {
    const session = reduceSession(emptySession(), { type: "start", task });
    expect(reduceSession(session, { type: "complete", task_id: 5 })).toBe(
      session,
    );
    expect(
      reduceSession(session, { type: "complete", task_id: 42 }),
    ).toMatchObject({ running: false, character: "complete", task });
  });
  it.each(characterStates)(
    "can simulate %s only in development without changing session progress",
    (character) => {
      const session = reduceSession(
        emptySession(),
        { type: "start", task },
        100,
      );
      expect(() =>
        reduceSession(session, { type: "character", character }, 200, false),
      ).toThrow("개발 빌드");
      expect(
        reduceSession(session, { type: "character", character }, 200, true),
      ).toMatchObject({
        simulated: true,
        character,
        running: true,
        startedAt: 100,
      });
    },
  );
  it.each([
    ["distracted", "recovery", false],
    ["studying", "focus", false],
    ["break", "idle", true],
  ] as const)(
    "checkin %s is self-report, never fabricated activity time",
    (choice, character, paused) => {
      const session = reduceSession(
        reduceSession(emptySession(), { type: "start", task }, 100),
        { type: "character", character: "checkin" },
        200,
        true,
      );
      expect(
        reduceSession(session, { type: "checkin", choice }, 300),
      ).toMatchObject({ character, paused, simulated: true, startedAt: 100 });
    },
  );
  it("rejects pausing without an active session", () => {
    expect(() => reduceSession(emptySession(), { type: "pause" })).toThrow();
  });
});
