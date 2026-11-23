/**
 * A fake `ImageEngine` for tests that need a runner but no image library: two screenshots are
 * the same exactly when their bytes are, a different one fails with every pixel counted as
 * changed and itself as the overlay, and `downscale` returns its input. Pixel-level behaviour
 * (thresholds, anti-aliasing, size changes) is `@storyshelf/runner/images`' and is tested there.
 */
import type { DiffResult, ImageEngine } from "../adapters/image-engine.ts";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width and height from a PNG's IHDR chunk; zeros for anything else. */
function dimensionsOf(image: Buffer): { width: number; height: number } {
  const isPng = image.length >= 24 && image.subarray(0, 8).equals(PNG_SIGNATURE);
  return isPng
    ? { width: image.readUInt32BE(16), height: image.readUInt32BE(20) }
    : { width: 0, height: 0 };
}

/** Byte comparison in the shape of a real diff. */
export function compareBytes(baseline: Buffer, current: Buffer): DiffResult {
  const baselineDimensions = dimensionsOf(baseline);
  const currentDimensions = dimensionsOf(current);
  const sizeChanged =
    baselineDimensions.width !== currentDimensions.width ||
    baselineDimensions.height !== currentDimensions.height;
  const same = baseline.equals(current);
  return {
    passed: same,
    diffPixels: same ? 0 : Math.max(1, currentDimensions.width * currentDimensions.height),
    diffRatio: same ? 0 : 1,
    diffImage: same ? null : Buffer.from(current),
    baselineDimensions,
    currentDimensions,
    sizeChanged,
  };
}

/** An in-memory engine; `compared` counts the comparisons. */
export function fakeImageEngine(): ImageEngine & { compared: number } {
  const engine = {
    compared: 0,
    configure: (): void => {},
    verify: async (): Promise<"pngjs"> => await Promise.resolve("pngjs"),
    compare: async (baseline: Buffer, current: Buffer) => {
      engine.compared += 1;
      return await Promise.resolve(compareBytes(baseline, current));
    },
    downscale: async (png: Uint8Array) => await Promise.resolve(png),
    state: () => ({ engine: "pngjs" as const, workers: 0, inThread: true }),
    shutdown: async (): Promise<void> => {},
  };
  return engine;
}
