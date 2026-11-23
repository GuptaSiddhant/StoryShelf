import { describe, expect, it } from "vitest";
import { compareBytes, fakeImageEngine } from "./fake-image-engine.ts";

/** A PNG signature plus an IHDR declaring `width` x `height` (enough for the dimensions). */
function pngHeader(width: number, height: number, fill = 0): Buffer {
  const header = Buffer.alloc(32, fill);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

describe("compareBytes", () => {
  it("passes equal bytes with nothing changed", () => {
    const shot = pngHeader(4, 3);
    expect(compareBytes(shot, Buffer.from(shot))).toMatchObject({
      passed: true,
      diffPixels: 0,
      diffRatio: 0,
      diffImage: null,
      currentDimensions: { width: 4, height: 3 },
      sizeChanged: false,
    });
  });

  it("fails different bytes with every pixel changed and the current image as overlay", () => {
    const current = pngHeader(4, 3, 1);
    const result = compareBytes(pngHeader(4, 3), current);
    expect(result).toMatchObject({ passed: false, diffPixels: 12, diffRatio: 1 });
    expect(result.diffImage?.equals(current)).toBe(true);
  });

  it("reports a size change and zero dimensions for non-PNG bytes", () => {
    expect(compareBytes(pngHeader(4, 3), pngHeader(5, 3)).sizeChanged).toBe(true);
    expect(compareBytes(Buffer.from("a"), Buffer.from("b")).currentDimensions).toEqual({
      width: 0,
      height: 0,
    });
  });
});

describe("fakeImageEngine", () => {
  it("counts comparisons and leaves images as they are", async () => {
    const engine = fakeImageEngine();
    const shot = pngHeader(2, 2);
    await engine.compare(shot, shot, {
      pixelThreshold: 0,
      maxDiffRatio: 0,
      includeAntialiasing: false,
      failOnSizeChange: true,
    });
    expect(engine.compared).toBe(1);
    expect(await engine.downscale(shot, 1)).toBe(shot);
    await expect(engine.verify()).resolves.toBe("pngjs");
    expect(engine.state()).toEqual({ engine: "pngjs", workers: 0, inThread: true });
  });
});
