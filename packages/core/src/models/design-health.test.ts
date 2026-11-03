import { describe, expect, it } from "vitest";
import { credentialDaysLeft, designChange, designDrift, isDesignStale } from "./design-health.ts";

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

describe("designDrift", () => {
  const approved = "2026-01-01T00:00:00Z";

  it("is current for an ok node not modified after the baseline", () => {
    expect(designDrift({ state: "ok", lastModified: "2025-12-01T00:00:00Z" }, approved)).toBe(
      "current",
    );
  });

  it("is stale when the design changed after the baseline was approved", () => {
    expect(designDrift({ state: "ok", lastModified: "2026-02-01T00:00:00Z" }, approved)).toBe(
      "stale",
    );
  });

  it("is deleted for a node that no longer exists, whatever the baseline", () => {
    expect(designDrift({ state: "deleted", lastModified: null }, approved)).toBe("deleted");
    expect(designDrift({ state: "deleted", lastModified: null }, null)).toBe("deleted");
  });

  it("is unknown without a baseline to compare with (nothing was compared)", () => {
    expect(designDrift({ state: "ok", lastModified: "2026-02-01T00:00:00Z" }, null)).toBe(
      "unknown",
    );
  });

  it("is unknown when the design has no readable modification time", () => {
    expect(designDrift({ state: "ok", lastModified: null }, approved)).toBe("unknown");
    expect(designDrift({ state: "ok", lastModified: "not a date" }, approved)).toBe("unknown");
  });

  it("is unknown when nothing is cached or the provider refused", () => {
    expect(designDrift(null, approved)).toBe("unknown");
    expect(designDrift(undefined, approved)).toBe("unknown");
    expect(designDrift({ state: "unauthorized", lastModified: null }, approved)).toBe("unknown");
    expect(designDrift({ state: "forbidden", lastModified: null }, approved)).toBe("unknown");
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
