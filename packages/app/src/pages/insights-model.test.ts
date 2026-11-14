import { describe, expect, it } from "vitest";
import { captureTimingsOf, formatBytes, formatDurationMs, queueViewOf } from "./insights-model.ts";

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

describe("formatBytes", () => {
  it("shows bytes below a kilobyte, then one decimal up to 100 and none above", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(812)).toBe("812 B");
    expect(formatBytes(4_820_000)).toBe("4.8 MB");
    expect(formatBytes(1_240_000_000)).toBe("1.2 GB");
    expect(formatBytes(512_000_000)).toBe("512 MB");
  });

  it("carries into the next unit at 1000 and stops at terabytes", () => {
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1000)).toBe("1.0 KB");
    expect(formatBytes(2_500_000_000_000_000)).toBe("2500 TB");
  });
});
