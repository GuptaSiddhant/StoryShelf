import { describe, expect, it } from "vitest";
import { countedTokens, crossedThresholds, utcDay, utcDayStart } from "./budget.ts";

describe("budget math", () => {
  it("uses the UTC day", () => {
    const d = new Date("2026-10-08T23:59:59.000Z");
    expect(utcDay(d)).toBe("2026-10-08");
    expect(utcDayStart(d)).toBe("2026-10-08T00:00:00.000Z");
  });

  it("weights tokens only when images were sent", () => {
    const usage = { inputTokens: 100, outputTokens: 20 };
    expect(countedTokens(usage, 0, { visionWeight: 5 })).toBe(120);
    expect(countedTokens(usage, 2, { visionWeight: 5 })).toBe(600);
  });

  it("returns every threshold crossed by one jump, each only once", () => {
    expect(crossedThresholds(0, 49, 100)).toEqual([]);
    expect(crossedThresholds(40, 80, 100)).toEqual([50, 75]);
    expect(crossedThresholds(80, 100, 100)).toEqual([90, 100]);
    expect(crossedThresholds(100, 150, 100)).toEqual([]);
    expect(crossedThresholds(0, 10, 0)).toEqual([]);
  });
});
