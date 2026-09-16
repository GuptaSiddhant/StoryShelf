import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { diffImages } from "./engine.ts";
import { DEFAULT_DIFF_OPTIONS } from "./options.ts";

function png(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number],
): Buffer {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) * 4;
      const [r, g, b] = fill(x, y);
      image.data[idx] = r;
      image.data[idx + 1] = g;
      image.data[idx + 2] = b;
      image.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(image);
}

const solid =
  (rgb: [number, number, number]) =>
  (_x: number, _y: number): [number, number, number] =>
    rgb;

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

  it("diffs the overlapping region when failOnSizeChange is disabled", () => {
    const options = { ...DEFAULT_DIFF_OPTIONS, failOnSizeChange: false };
    const a = png(4, 4, solid([0, 0, 0]));
    const b = png(8, 8, solid([0, 0, 0]));
    const result = diffImages(a, b, options);
    expect(result.sizeChanged).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.diffPixels).toBe(0);
    expect(result.diffRatio).toBe(0);
    expect(result.diffImage).not.toBeNull();
  });

  it("counts changed pixels in the overlap when failOnSizeChange is disabled", () => {
    const options = { ...DEFAULT_DIFF_OPTIONS, failOnSizeChange: false };
    const a = png(4, 4, solid([255, 0, 0]));
    const b = png(8, 4, (x, y) => (x === 0 && y === 0 ? [0, 0, 255] : [255, 0, 0]));
    const result = diffImages(a, b, options);
    expect(result.sizeChanged).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.diffPixels).toBe(1);
    expect(result.diffRatio).toBe(1 / 16);
    expect(result.diffImage).not.toBeNull();
  });

  it("keeps failing on size change when failOnSizeChange is enabled", () => {
    const options = { ...DEFAULT_DIFF_OPTIONS, failOnSizeChange: true };
    const a = png(4, 4, solid([0, 0, 0]));
    const b = png(8, 8, solid([0, 0, 0]));
    const result = diffImages(a, b, options);
    expect(result.passed).toBe(false);
    expect(result.diffPixels).toBe(0);
    expect(result.diffRatio).toBe(1);
    expect(result.sizeChanged).toBe(true);
    expect(result.diffImage).toBeNull();
  });
});
