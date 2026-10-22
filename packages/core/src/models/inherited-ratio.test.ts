import { describe, expect, it } from "vitest";
import { averageInheritedRatio } from "./inherited-ratio.ts";

const build = (createdAt: string, snapshotCount: number, inheritedCount: number) => ({
  createdAt,
  snapshotCount,
  inheritedCount,
});

describe("averageInheritedRatio", () => {
  it("is null without a build that holds snapshots", () => {
    expect(averageInheritedRatio([])).toBeNull();
    expect(averageInheritedRatio([build("2026-01-01", 0, 0)])).toBeNull();
  });

  it("averages each build's own ratio", () => {
    expect(
      averageInheritedRatio([build("2026-01-01", 10, 5), build("2026-01-02", 100, 100)]),
    ).toEqual({ ratio: 0.75, builds: 2 });
  });

  it("looks at the newest builds only and skips empty ones", () => {
    const builds = [
      build("2026-01-01", 10, 0),
      build("2026-01-02", 10, 10),
      build("2026-01-03", 0, 0),
      build("2026-01-04", 10, 10),
    ];
    expect(averageInheritedRatio(builds, 2)).toEqual({ ratio: 1, builds: 2 });
  });

  it("never exceeds 1 for odd stored counts", () => {
    expect(averageInheritedRatio([build("2026-01-01", 2, 5)])?.ratio).toBe(1);
  });
});
