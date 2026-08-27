import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";

import { diffImages } from "./engine.ts";
import { DEFAULT_DIFF_OPTIONS } from "./options.ts";

function png(width: number, height: number, fill: (x: number, y: number) => [number, number, number]): Buffer {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) << 2;
      const [r, g, b] = fill(x, y);
      image.data[idx] = r;
      image.data[idx + 1] = g;
      image.data[idx + 2] = b;
      image.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(image);
}

const solid = (rgb: [number, number, number]) => (_x: number, _y: number) => rgb;

describe("diffImages", () => {
  it("reports zero diff for identical images", () => {
    const a = png(4, 4, solid([255, 0, 0]));
    const result = diffImages(a, a, DEFAULT_DIFF_OPTIONS);
    expect(result.passed).toBe(true);
    expect(result.diffPixels).toBe(0);
    expect(result.sizeChanged).toBe(false);
  });

  it("detects a changed pixel", () => {
    const a = png(4, 4, solid([255, 0, 0]));
    const b = png(4, 4, (x, y) => (x === 0 && y === 0 ? [0, 0, 255] : [255, 0, 0]));
    const result = diffImages(a, b, DEFAULT_DIFF_OPTIONS);
    expect(result.passed).toBe(false);
    expect(result.diffPixels).toBeGreaterThan(0);
    expect(result.diffImage).not.toBeNull();
  });

  it("flags size change", () => {
    const a = png(4, 4, solid([0, 0, 0]));
    const b = png(8, 8, solid([0, 0, 0]));
    const result = diffImages(a, b, DEFAULT_DIFF_OPTIONS);
    expect(result.passed).toBe(false);
    expect(result.sizeChanged).toBe(true);
    expect(result.diffImage).toBeNull();
  });
});
