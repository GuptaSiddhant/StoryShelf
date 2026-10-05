import { describe, expect, it } from "vitest";
import type { Baseline } from "../schema/baseline.ts";
import { baselineStatus, isBaselineDrifted, NO_BASELINE } from "./baseline-status.ts";

const baseline: Baseline = {
  id: "bl1",
  projectId: "p1",
  storyId: "a",
  viewportName: "desktop",
  branch: "main",
  snapshotId: "s0",
  screenshotPath: "/b.png",
  infraHash: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

describe("baselineStatus", () => {
  it("is unknown for legacy rows without tracking", () => {
    expect(baselineStatus({ baselineId: null, baselineVersion: null }, baseline)).toBe("unknown");
    expect(baselineStatus({ baselineId: null, baselineVersion: null }, null)).toBe("unknown");
  });

  it("is current when id and version still match", () => {
    const snapshot = { baselineId: "bl1", baselineVersion: baseline.updatedAt };
    expect(baselineStatus(snapshot, baseline)).toBe("current");
  });

  it("is stale when the baseline was updated in place", () => {
    const snapshot = { baselineId: "bl1", baselineVersion: "2026-01-01T00:00:00.000Z" };
    expect(baselineStatus(snapshot, baseline)).toBe("stale");
  });

  it("is stale when a different baseline now applies (fallback replaced by own branch)", () => {
    const snapshot = { baselineId: "other", baselineVersion: baseline.updatedAt };
    expect(baselineStatus(snapshot, baseline)).toBe("stale");
  });

  it("is removed when the recorded baseline no longer exists", () => {
    const snapshot = { baselineId: "bl1", baselineVersion: baseline.updatedAt };
    expect(baselineStatus(snapshot, null)).toBe("removed");
  });

  it("treats a new story as current until a baseline appears", () => {
    const snapshot = { baselineId: null, baselineVersion: NO_BASELINE };
    expect(baselineStatus(snapshot, null)).toBe("current");
    expect(baselineStatus(snapshot, baseline)).toBe("stale");
  });
});

describe("isBaselineDrifted", () => {
  it("blocks only stale and removed", () => {
    expect(isBaselineDrifted("stale")).toBe(true);
    expect(isBaselineDrifted("removed")).toBe(true);
    expect(isBaselineDrifted("current")).toBe(false);
    expect(isBaselineDrifted("unknown")).toBe(false);
  });
});
