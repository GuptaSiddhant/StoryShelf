import { describe, expect, it } from "vitest";
import { credentialDaysLeft, designChange, isDesignStale } from "./design-health.ts";

describe("isDesignStale / credentialDaysLeft", () => {
  const node = { state: "ok", lastModified: "2026-02-01T00:00:00Z" };
  it("is stale only when the design moved after approval", () => {
    expect(isDesignStale(node, "2026-01-01T00:00:00Z")).toBe(true);
    expect(isDesignStale(node, "2026-03-01T00:00:00Z")).toBe(false);
    expect(isDesignStale(node, "no-baseline")).toBe(false);
    expect(isDesignStale(node, null)).toBe(false);
    expect(isDesignStale(null, "2026-01-01T00:00:00Z")).toBe(false);
    expect(
      isDesignStale({ state: "deleted", lastModified: node.lastModified }, "2026-01-01T00:00:00Z"),
    ).toBe(false);
    expect(isDesignStale({ state: "ok", lastModified: null }, "2026-01-01T00:00:00Z")).toBe(false);
  });

  it("counts days left of the provider's maximum credential age", () => {
    const now = new Date("2026-04-01T00:00:00Z");
    expect(credentialDaysLeft("2026-04-01T00:00:00Z", 90, now)).toBe(90);
    expect(credentialDaysLeft("2025-12-31T00:00:00Z", 90, now)).toBe(-1);
    expect(credentialDaysLeft("2026-03-22T00:00:00Z", 30, now)).toBe(20);
  });
});

describe("designChange", () => {
  const node = { state: "ok", version: "7", lastModified: "2026-02-01T00:00:00Z" };

  it("reports a design modified after the baseline was approved, keyed by its version", () => {
    expect(designChange(node, "2026-01-01T00:00:00Z")).toEqual({
      change: "modified-after-approval",
      key: "modified-after-approval:7",
      designVersion: "7",
    });
    expect(designChange({ ...node, version: "8" }, "2026-01-01T00:00:00Z")?.key).toBe(
      "modified-after-approval:8",
    );
  });

  it("falls back to the modified time when the provider gave no version", () => {
    expect(designChange({ ...node, version: null }, "2026-01-01T00:00:00Z")?.designVersion).toBe(
      "2026-02-01T00:00:00Z",
    );
  });

  it("reports a deleted node whatever the baseline, keeping its last known version", () => {
    const gone = { state: "deleted", version: "7", lastModified: "2026-02-01T00:00:00Z" };
    expect(designChange(gone, null)).toEqual({
      change: "deleted",
      key: "deleted:7",
      designVersion: "7",
    });
    expect(designChange({ state: "deleted", version: null, lastModified: null }, null)?.key).toBe(
      "deleted:",
    );
  });

  it("stays quiet for a current, unknown, unreadable or absent design", () => {
    expect(designChange(node, "2026-03-01T00:00:00Z")).toBeNull();
    expect(designChange(node, null)).toBeNull();
    expect(designChange({ ...node, state: "unauthorized" }, "2026-01-01T00:00:00Z")).toBeNull();
    expect(designChange(null, "2026-01-01T00:00:00Z")).toBeNull();
  });
});
