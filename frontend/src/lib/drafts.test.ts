import { describe, expect, it } from "vitest";
import {
  blankDraft,
  editDraft,
  serializeDrafts,
  validateDrafts,
} from "./drafts";
import { duration, toKstInput } from "./time";

describe("backend-compatible drafts", () => {
  const valid = () => ({
    ...blankDraft("  발표 준비  "),
    deadline: "2026-11-12T18:00",
    minutes: "120",
  });
  it("sends explicit Korea timezone and trims names", () => {
    expect(serializeDrafts([valid()])).toEqual([
      {
        name: "발표 준비",
        deadline: "2026-11-12T18:00:00+09:00",
        estimated_minutes: 120,
        important: false,
      },
    ]);
    expect(toKstInput("2026-11-12T09:00:00Z")).toBe("2026-11-12T18:00");
    expect(editDraft(serializeDrafts([valid()])[0]).deadline).toBe(
      "2026-11-12T18:00",
    );
  });
  it("enforces server bounds including integer minutes and batch size", () => {
    expect(validateDrafts([valid()])).toBeNull();
    for (const minutes of ["", "4", "6001", "5.5", "NaN"])
      expect(validateDrafts([{ ...valid(), minutes }])).not.toBeNull();
    for (const minutes of ["5", "6000"])
      expect(validateDrafts([{ ...valid(), minutes }])).toBeNull();
    expect(validateDrafts([])).not.toBeNull();
    expect(validateDrafts(Array.from({ length: 31 }, valid))).not.toBeNull();
    expect(validateDrafts([{ ...valid(), name: " " }])).not.toBeNull();
    expect(
      validateDrafts([{ ...valid(), name: "가".repeat(101) }]),
    ).not.toBeNull();
    expect(validateDrafts([{ ...valid(), deadline: "" }])).not.toBeNull();
    expect(
      validateDrafts([{ ...valid(), deadline: "invalid" }]),
    ).not.toBeNull();
  });
  it("formats duration including zero", () => {
    expect(duration(0)).toBe("0분");
    expect(duration(120)).toBe("2시간");
    expect(duration(91)).toBe("1시간 31분");
  });
});
