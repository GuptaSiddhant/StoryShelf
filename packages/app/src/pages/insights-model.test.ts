import { describe, expect, it } from "vitest";
import { captureTimingsOf, formatDurationMs } from "./insights-model.ts";

describe("captureTimingsOf", () => {
  it("is null when no snapshot reports a duration", () => {
    expect(captureTimingsOf([])).toBeNull();
    expect(captureTimingsOf([{ durationMs: null }])).toBeNull();
  });

  it("averages, ranks and skips the unmeasured", () => {
    const snapshots = [100, 200, 300, 400, null].map((durationMs) => ({ durationMs }));
    expect(captureTimingsOf(snapshots)).toEqual({
      measured: 4,
      averageMs: 250,
      p95Ms: 400,
      slowestMs: 400,
    });
  });
});

describe("formatDurationMs", () => {
  it("picks the unit", () => {
    expect(formatDurationMs(850)).toBe("850 ms");
    expect(formatDurationMs(4200)).toBe("4.2 s");
    expect(formatDurationMs(125_000)).toBe("2 min 5 s");
  });
});
