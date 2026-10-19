import { describe, expect, it, vi } from "vitest";
import { makeStorage } from "../test-helpers/fake-adapters.ts";
import { diffStoredScreenshots, resolvePixelThreshold } from "./diff-record.ts";

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

describe("diffStoredScreenshots", () => {
  const project = { pixelThreshold: 0.1, maxDiffRatio: 0.01 };

  it("treats the same path as identical without reading either image", async () => {
    const { storage } = makeStorage();
    const read = vi.spyOn(storage, "read");
    const result = await diffStoredScreenshots(
      storage,
      project,
      "p1/content/abc.png",
      "p1/content/abc.png",
    );
    expect(result).toMatchObject({ passed: true, diffPixels: 0, diffRatio: 0, diffImage: null });
    expect(result.sizeChanged).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it("reads and compares when the paths differ", async () => {
    const { storage, objects } = makeStorage();
    objects.set("a.png", Buffer.from("not a png"));
    objects.set("b.png", Buffer.from("not a png either"));
    await expect(diffStoredScreenshots(storage, project, "a.png", "b.png")).rejects.toThrow();
  });
});
