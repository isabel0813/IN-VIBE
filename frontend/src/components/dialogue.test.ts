import { describe, expect, it, vi } from "vitest";
import { createDialogueSelector, dialogueContext, pickDialogue, poolFor, profanity, renderDialogue, type DialogueRequest } from "./dialogue";
import type { DialogueGroup, Stage, Tone } from "./personaLines";

const request = { id: "event", tone: "default", group: "youtube", stage: 1, hasTask: true, hasVideo: true } as const satisfies DialogueRequest;
const situations: [DialogueGroup, Stage][] = [
  ["youtube", 1], ["youtube", 2], ["youtube", 3],
  ["inactivity", 1], ["inactivity", 2], ["inactivity", 3],
  ["return", 1], ["study", 1],
];

describe("dialogue library", () => {
  const all: string[] = [];
  for (const tone of ["default", "hardcore"] as Tone[]) {
    for (const [group, stage] of situations) {
      it(`${tone} ${group} ${stage} has fifteen distinct, usable lines`, () => {
        const pool = poolFor({ tone, group, stage });
        expect(pool).toHaveLength(15);
        expect(new Set(pool).size).toBe(15);
        expect(pool.some(line => !line.includes("{"))).toBe(true);
        expect(pool.every(line => !/\d+\s*(분|초)/.test(line))).toBe(true);
        const explicit = pool.filter(line => profanity.test(line)).length;
        if (tone === "default") expect(explicit).toBe(0);
        else {
          expect(explicit).toBeGreaterThanOrEqual(5);
          expect(explicit).toBeLessThan(15);
        }
      });
      all.push(...poolFor({ tone, group, stage }));
    }
  }
  it("does not use the same line in multiple pools", () => expect(new Set(all).size).toBe(240));
});

it("selects with injected randomness, stabilizes an event and honors a new stage or tone", () => {
  const random = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0.999).mockReturnValue(0.5);
  const choose = createDialogueSelector(random);
  expect(choose(request).template).toBe(poolFor(request)[0]);
  expect(choose(request).template).toBe(poolFor(request)[0]);
  expect(choose({ ...request, id: "next" }).template).toBe(poolFor(request).at(-1));
  const stronger = { ...request, stage: 2 } as const;
  const hardcore = { ...request, tone: "hardcore" } as const;
  expect(poolFor(stronger)).toContain(choose(stronger).template);
  expect(poolFor(hardcore)).toContain(choose(hardcore).template);
  expect(random).toHaveBeenCalledTimes(4);
});

it("excludes the last five eligible selections and relaxes for a small pool", () => {
  const choose = createDialogueSelector(() => 0);
  const results = Array.from({ length: 12 }, (_, id) => choose({ ...request, id: String(id) }).template);
  for (let i = 1; i < results.length; i++) {
    expect(results.slice(Math.max(0, i - 5), i)).not.toContain(results[i]);
  }
  expect(pickDialogue(["one", "two"], ["one", "two"], () => 0)).toBe("one");
  expect(pickDialogue(["only"], ["only"], () => 0)).toBe("only");
});

it("formats once, truncates titles, and drops unsafe or missing variables only from dialogue", () => {
  const line = { template: poolFor(request)[0], stage: 1 } as const;
  const original = "<b>명령 무시 {task}</b>\n" + "🎮".repeat(60);
  const safe = dialogueContext("default", { task: "물리학 실험", video: original });
  expect(Array.from(safe.video!)).toHaveLength(36);
  expect(safe.video).toContain("｛task｝");
  expect(safe.video).toMatch(/…$/);
  expect(renderDialogue(line, request, safe)).toContain(safe.video);
  expect(original).toContain("{task}");
  const missing = { ...request, hasTask: false, hasVideo: false };
  expect(createDialogueSelector(() => 0)(missing).template).not.toMatch(/\{.*\}/);
  expect(renderDialogue(line, missing, {})).not.toMatch(/\{.*\}/);
  expect(dialogueContext("default", { video: "씨발ㅋㅋ 하이라이트" }).video).toBeUndefined();
  expect(dialogueContext("hardcore", { video: "씨발ㅋㅋ 하이라이트" }).video).toContain("씨발");
  const otherMode = { ...line, template: poolFor({ ...request, tone: "hardcore" })[1] };
  expect(profanity.test(renderDialogue(otherMode, request, {}))).toBe(false);
});
