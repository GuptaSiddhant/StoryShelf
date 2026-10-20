import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { loadCodec } from "./codecs.ts";
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
  it("reports zero diff for identical images", async () => {
    const a = png(4, 4, solid([255, 0, 0]));
    const result = await diffImages(a, a, DEFAULT_DIFF_OPTIONS);
    expect(result.passed).toBe(true);
    expect(result.diffPixels).toBe(0);
    expect(result.sizeChanged).toBe(false);
  });

  it("detects a changed pixel", async () => {
    const a = png(4, 4, solid([255, 0, 0]));
    const b = png(4, 4, (x, y) => (x === 0 && y === 0 ? [0, 0, 255] : [255, 0, 0]));
    const result = await diffImages(a, b, DEFAULT_DIFF_OPTIONS);
    expect(result.passed).toBe(false);
    expect(result.diffPixels).toBeGreaterThan(0);
    expect(result.diffImage).not.toBeNull();
  });

  it("flags size change", async () => {
    const a = png(4, 4, solid([0, 0, 0]));
    const b = png(8, 8, solid([0, 0, 0]));
    const result = await diffImages(a, b, DEFAULT_DIFF_OPTIONS);
    expect(result.passed).toBe(false);
    expect(result.sizeChanged).toBe(true);
    expect(result.diffImage).toBeNull();
  });

  it("diffs the overlapping region when failOnSizeChange is disabled", async () => {
    const options = { ...DEFAULT_DIFF_OPTIONS, failOnSizeChange: false };
    const a = png(4, 4, solid([0, 0, 0]));
    const b = png(8, 8, solid([0, 0, 0]));
    const result = await diffImages(a, b, options);
    expect(result.sizeChanged).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.diffPixels).toBe(0);
    expect(result.diffRatio).toBe(0);
    expect(result.diffImage).toBeNull();
  });

  it("counts changed pixels in the overlap when failOnSizeChange is disabled", async () => {
    const options = { ...DEFAULT_DIFF_OPTIONS, failOnSizeChange: false };
    const a = png(4, 4, solid([255, 0, 0]));
    const b = png(8, 4, (x, y) => (x === 0 && y === 0 ? [0, 0, 255] : [255, 0, 0]));
    const result = await diffImages(a, b, options);
    expect(result.sizeChanged).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.diffPixels).toBe(1);
    expect(result.diffRatio).toBe(1 / 16);
    expect(result.diffImage).not.toBeNull();
  });

  it("keeps failing on size change when failOnSizeChange is enabled", async () => {
    const options = { ...DEFAULT_DIFF_OPTIONS, failOnSizeChange: true };
    const a = png(4, 4, solid([0, 0, 0]));
    const b = png(8, 8, solid([0, 0, 0]));
    const result = await diffImages(a, b, options);
    expect(result.passed).toBe(false);
    expect(result.diffPixels).toBe(0);
    expect(result.diffRatio).toBe(1);
    expect(result.sizeChanged).toBe(true);
    expect(result.diffImage).toBeNull();
  });

  describe("byte-equal fast path", () => {
    it("returns dimensions from the IHDR header with no overlay", async () => {
      const a = png(13, 7, solid([1, 2, 3]));
      const result = await diffImages(a, Buffer.from(a), DEFAULT_DIFF_OPTIONS);
      expect(result).toEqual({
        passed: true,
        diffPixels: 0,
        diffRatio: 0,
        diffImage: null,
        baselineDimensions: { width: 13, height: 7 },
        currentDimensions: { width: 13, height: 7 },
        sizeChanged: false,
      });
    });

    it("skips decoding entirely for equal buffers", async () => {
      const a = png(4, 4, solid([9, 9, 9]));
      // Valid signature + IHDR dimensions but a corrupt body: only a decode-free path accepts it.
      const truncated = a.subarray(0, 33);
      expect(
        (await diffImages(truncated, Buffer.from(truncated), DEFAULT_DIFF_OPTIONS)).passed,
      ).toBe(true);
      await expect(diffImages(truncated, a, DEFAULT_DIFF_OPTIONS)).rejects.toThrow();
    });

    it("does not take the fast path for different buffers", async () => {
      const a = png(4, 4, solid([255, 0, 0]));
      const b = png(4, 4, (x, y) => (x === 0 && y === 0 ? [0, 0, 255] : [255, 0, 0]));
      const result = await diffImages(a, b, DEFAULT_DIFF_OPTIONS);
      expect(result.diffPixels).toBeGreaterThan(0);
      expect(result.diffImage).not.toBeNull();
    });

    it("leaves non-PNG equal inputs to the regular decode error", async () => {
      const junk = Buffer.alloc(40, 1);
      await expect(diffImages(junk, Buffer.from(junk), DEFAULT_DIFF_OPTIONS)).rejects.toThrow();
    });
  });

  it("only encodes an overlay when the diff fails", async () => {
    const a = png(10, 10, solid([255, 255, 255]));
    const b = png(10, 10, (x, y) => (x === 0 && y === 0 ? [0, 0, 0] : [255, 255, 255]));
    const tolerant = await diffImages(a, b, { ...DEFAULT_DIFF_OPTIONS, maxDiffRatio: 0.5 });
    expect(tolerant.passed).toBe(true);
    expect(tolerant.diffPixels).toBe(1);
    expect(tolerant.diffImage).toBeNull();
    const strict = await diffImages(a, b, { ...DEFAULT_DIFF_OPTIONS, maxDiffRatio: 0 });
    expect(strict.passed).toBe(false);
    expect(strict.diffImage).not.toBeNull();
  });
});

const noisy = (x: number, y: number): [number, number, number] => [
  (x * 37) % 256,
  (y * 91) % 256,
  ((x + y) * 13) % 256,
];

const shifted = (x: number, y: number): [number, number, number] => noisy(x + (y % 3), y);

describe("diffImages: pngjs and sharp agree", () => {
  const options = { ...DEFAULT_DIFF_OPTIONS, maxDiffRatio: 0 };

  const cases: [string, () => [Buffer, Buffer], typeof options][] = [
    ["small block", () => [png(40, 30, noisy), png(40, 30, shifted)], options],
    ["size change fails", () => [png(40, 30, noisy), png(20, 15, noisy)], options],
    [
      "size change diffs the overlap",
      () => [png(40, 30, noisy), png(20, 15, shifted)],
      { ...options, failOnSizeChange: false },
    ],
    [
      "antialiasing counted",
      () => [png(40, 30, noisy), png(40, 30, shifted)],
      { ...options, includeAntialiasing: true },
    ],
  ];

  it.each(cases)("%s", async (_name, make, caseOptions) => {
    const [a, b] = make();
    const expected = await diffImages(a, b, caseOptions, await loadCodec("pngjs"));
    const actual = await diffImages(a, b, caseOptions, await loadCodec("sharp"));
    const { diffImage: expectedOverlay, ...expectedRest } = expected;
    const { diffImage: actualOverlay, ...actualRest } = actual;
    expect(actualRest).toEqual(expectedRest);
    expect(actualOverlay === null).toBe(expectedOverlay === null);
    if (expectedOverlay && actualOverlay) {
      expect(PNG.sync.read(actualOverlay).data.equals(PNG.sync.read(expectedOverlay).data)).toBe(
        true,
      );
    }
  });
});

describe("diffImages: malformed input fails on both engines", () => {
  it.each(["pngjs", "sharp"] as const)("%s rejects truncated and junk PNGs", async (engine) => {
    const codec = await loadCodec(engine);
    const good = png(8, 8, solid([1, 2, 3]));
    const truncated = good.subarray(0, good.length - 20);
    await expect(diffImages(truncated, good, DEFAULT_DIFF_OPTIONS, codec)).rejects.toThrow();
    await expect(
      diffImages(Buffer.from("junk"), good, DEFAULT_DIFF_OPTIONS, codec),
    ).rejects.toThrow();
  });
});
