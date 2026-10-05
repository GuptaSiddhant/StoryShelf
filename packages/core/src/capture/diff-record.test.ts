import { describe, expect, it } from "vitest";
import { resolvePixelThreshold } from "./diff-record.ts";

describe("resolvePixelThreshold", () => {
  it("uses the project threshold without an override", () => {
    expect(resolvePixelThreshold(0.1)).toBe(0.1);
  });

  it("uses a per-story override in 0..1, including the bounds", () => {
    expect(resolvePixelThreshold(0.1, 0.2)).toBe(0.2);
    expect(resolvePixelThreshold(0.1, 0)).toBe(0);
    expect(resolvePixelThreshold(0.1, 1)).toBe(1);
  });

  it("falls back for out-of-range or non-finite overrides", () => {
    expect(resolvePixelThreshold(0.1, -0.1)).toBe(0.1);
    expect(resolvePixelThreshold(0.1, 1.5)).toBe(0.1);
    expect(resolvePixelThreshold(0.1, Number.NaN)).toBe(0.1);
    expect(resolvePixelThreshold(0.1, Number.POSITIVE_INFINITY)).toBe(0.1);
  });
});
