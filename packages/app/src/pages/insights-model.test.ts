import { describe, expect, it } from "vitest";
import { captureTimingsOf, formatDurationMs, queueViewOf } from "./insights-model.ts";

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

const entry = (buildId: string) => ({ buildId, status: "capturing", queuedAt: "2026-01-01" });

describe("queueViewOf", () => {
  it("keeps only the entries of the project's own builds", () => {
    const shared = [entry("mine-1"), entry("theirs-1"), entry("mine-2")];
    expect(queueViewOf(shared, new Set(["mine-1", "mine-2"])).map((item) => item.buildId)).toEqual([
      "mine-1",
      "mine-2",
    ]);
  });

  it("shows nothing for a project without builds in the queue", () => {
    expect(queueViewOf([entry("theirs-1")], new Set())).toEqual([]);
  });
});
