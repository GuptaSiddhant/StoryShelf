import { describe, expect, it } from "vitest";
import { credentialDaysLeft, isDesignStale } from "./design-health.ts";

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
