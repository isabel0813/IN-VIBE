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
      it(`${tone} ${group} ${stage} has enough distinct lines even without context`, () => {
        const pool = poolFor({ tone, group, stage });
        expect(pool.length).toBeGreaterThanOrEqual(8);
        expect(pool.length).toBeLessThanOrEqual(12);
        expect(new Set(pool).size).toBe(pool.length);
        expect(pool.filter(line => !line.includes("{")).length).toBeGreaterThanOrEqual(8);
        expect(pool.every(line => !/\d+\s*(분|초)/.test(line))).toBe(true);
        const explicit = pool.filter(line => profanity.test(line)).length;
        if (tone === "default") expect(explicit).toBe(0);
        else {
          expect(explicit).toBeGreaterThanOrEqual(Math.ceil(pool.length / 3));
          expect(explicit).toBeLessThan(pool.length);
        }
        const choose = createDialogueSelector(() => 0);
        const seen: string[] = [];
        for (let i = 0; i < pool.length * 2; i++) {
          const { template } = choose({ id: String(i), tone, group, stage, hasTask: false, hasVideo: false });
          expect(seen.slice(-5)).not.toContain(template);
          seen.push(template);
        }
      });
      all.push(...poolFor({ tone, group, stage }));
    }
  }
  it("keeps the edited corpus in range with no duplicate lines", () => {
    expect(all.length).toBeGreaterThanOrEqual(150);
    expect(all.length).toBeLessThanOrEqual(170);
    expect(new Set(all).size).toBe(all.length);
  });
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

it.each([
  { task: "물리학 실험 보고서 작성", video: "롤 하이라이트 모음" },
  { task: "일반수학2 기말고사 공부", video: "공식 뮤직비디오 플레이리스트" },
  { task: "물리학 실험 보고서 작성과 제출 전 최종 검토 ".repeat(3), video: "공식 뮤직비디오 플레이리스트 ".repeat(5) },
])("renders quoted variables with stable suffixes and brief dialogue for $task", (values) => {
  for (const tone of ["default", "hardcore"] as const) {
    const context = dialogueContext(tone, values);
    for (const [group, stage] of situations) {
      for (const template of poolFor({ tone, group, stage })) {
        const variables = Array.from(template.matchAll(/\{(task|video)\}/g));
        expect(variables.length, template).toBeLessThanOrEqual(1);
        const [variable] = variables;
        if (variable) {
          // After the closing quote, only invariant suffixes or punctuation are allowed.
          expect(template, template).toMatch(/\{(?:task|video)\}」(?:도|에|부터|[\s,.?!]|$)/u);
        }
        const rendered = renderDialogue({ template, stage }, { ...request, tone, group, stage }, context);
        if (variable) expect(rendered).toContain(context[variable[1] as "task" | "video"]);
        expect(rendered).not.toMatch(/\{(?:task|video)\}/);
        expect(Array.from(rendered).length, rendered).toBeLessThanOrEqual(70);
      }
    }
  }
});
