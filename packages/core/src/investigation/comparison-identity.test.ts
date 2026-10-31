import { describe, expect, it } from "vitest";
import { investigationComparisonKey, type InvestigationComparison } from "./comparison-identity.ts";

const comparison: InvestigationComparison = {
  projectId: "project",
  snapshotId: "snapshot",
  currentSourceBuildId: "current",
  baselineId: "baseline",
  baselineVersion: "version",
  baselineSourceBuildId: "source",
  baselineSourceSnapshotId: null,
  referenceImageSha256: "a".repeat(64),
  mode: { viewport: "desktop", color: "light" },
  target: "chromium",
  captureSettings: { viewport: { width: 800, height: 600 }, flags: ["a", "b"] },
  evidenceFormatVersion: 1,
};

describe("investigation comparison identity", () => {
  it("normalizes object order without normalizing array order", () => {
    const key = investigationComparisonKey(comparison);
    expect(
      investigationComparisonKey({
        ...comparison,
        mode: { color: "light", viewport: "desktop" },
        captureSettings: { flags: ["a", "b"], viewport: { height: 600, width: 800 } },
      }),
    ).toBe(key);
    expect(
      investigationComparisonKey({
        ...comparison,
        captureSettings: { flags: ["b", "a"], viewport: { height: 600, width: 800 } },
      }),
    ).not.toBe(key);
  });
  it("distinguishes comparison, source, target and evidence changes", () => {
    const key = investigationComparisonKey(comparison);
    for (const change of [
      { projectId: "other" },
      { snapshotId: "other" },
      { currentSourceBuildId: "other" },
      { baselineId: "other" },
      { baselineVersion: "other" },
      { baselineSourceBuildId: "other" },
      { baselineSourceSnapshotId: "other" },
      { referenceImageSha256: "b".repeat(64) },
      { target: "firefox" },
      { mode: null },
      { captureSettings: null },
      { evidenceFormatVersion: 2 },
    ])
      expect(investigationComparisonKey({ ...comparison, ...change })).not.toBe(key);
  });
  it("rejects missing sources, malformed hashes, non-finite settings and invalid formats", () => {
    expect(() =>
      investigationComparisonKey({ ...comparison, baselineSourceBuildId: "" }),
    ).toThrow();
    expect(() =>
      investigationComparisonKey({ ...comparison, referenceImageSha256: "unknown" }),
    ).toThrow();
    expect(() => investigationComparisonKey({ ...comparison, evidenceFormatVersion: 0 })).toThrow();
    expect(() =>
      investigationComparisonKey({ ...comparison, captureSettings: { width: Number.NaN } }),
    ).toThrow();
  });
});
