import { describe, expect, it } from "vitest";
import { isDesignStale, tokenDaysLeft } from "./figma-health.ts";

describe("isDesignStale / tokenDaysLeft", () => {
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

  it("counts days left of the 90-day cap", () => {
    const now = new Date("2026-04-01T00:00:00Z");
    expect(tokenDaysLeft("2026-04-01T00:00:00Z", now)).toBe(90);
    expect(tokenDaysLeft("2025-12-31T00:00:00Z", now)).toBe(-1);
  });
});
