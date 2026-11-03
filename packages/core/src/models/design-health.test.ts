import { describe, expect, it } from "vitest";
import { credentialDaysLeft, designDrift, isDesignStale } from "./design-health.ts";

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

  it("is unknown when nothing is cached or the provider refused", () => {
    expect(designDrift(null, approved)).toBe("unknown");
    expect(designDrift(undefined, approved)).toBe("unknown");
    expect(designDrift({ state: "unauthorized", lastModified: null }, approved)).toBe("unknown");
    expect(designDrift({ state: "forbidden", lastModified: null }, approved)).toBe("unknown");
  });
});
