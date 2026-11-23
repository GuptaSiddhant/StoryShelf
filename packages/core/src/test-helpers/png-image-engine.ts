/**
 * A test-only `ImageEngine` for core's own tests, on the `pngjs` and `pixelmatch` dev dependencies.
 * It compares like `@storyshelf/runner/images` (pixelmatch with the same options, size changes,
 * overlay only for a failing diff) but in-thread and without the worker pool. It is never exported
 * from `test-helpers/index.ts` and never imported by shipped code: core does not import an image
 * library (#1365, `no-image-libraries.test.ts`).
 */
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import type { DiffOptions, DiffResult, ImageEngine } from "../adapters/image-engine.ts";

/** An in-thread pngjs engine; `compare` counts its calls. */
export function pngImageEngine(): ImageEngine & { compared: number } {
  const engine = {
    compared: 0,
    configure: (): void => {},
    verify: async (): Promise<"pngjs"> => await Promise.resolve("pngjs"),
    compare: async (baseline: Buffer, current: Buffer, options: DiffOptions) => {
      engine.compared += 1;
      return await Promise.resolve(comparePngs(baseline, current, options));
    },
    downscale: async (png: Uint8Array, maxEdge: number) =>
      await Promise.resolve(downscale(png, maxEdge)),
    state: () => ({ engine: "pngjs" as const, workers: 0, inThread: true }),
    shutdown: async (): Promise<void> => {},
  };
  return engine;
}

function comparePngs(baseline: Buffer, current: Buffer, options: DiffOptions): DiffResult {
  const before = PNG.sync.read(baseline);
  const after = PNG.sync.read(current);
  const baselineDimensions = { width: before.width, height: before.height };
  const currentDimensions = { width: after.width, height: after.height };
  const sizeChanged = before.width !== after.width || before.height !== after.height;
  const base = { baselineDimensions, currentDimensions, sizeChanged };
  if (sizeChanged && options.failOnSizeChange) {
    return { ...base, passed: false, diffPixels: 0, diffRatio: 1, diffImage: null };
  }
  const width = Math.min(before.width, after.width);
  const height = Math.min(before.height, after.height);
  const overlay = new PNG({ width, height });
  const diffPixels = pixelmatch(
    crop(before, width, height),
    crop(after, width, height),
    overlay.data,
    width,
    height,
    {
      threshold: options.pixelThreshold,
      includeAA: options.includeAntialiasing,
    },
  );
  const diffRatio = diffPixels / (width * height);
  const passed = diffRatio <= options.maxDiffRatio;
  return {
    ...base,
    passed,
    diffPixels,
    diffRatio,
    diffImage: passed ? null : PNG.sync.write(overlay),
  };
}

/** The top-left `width` x `height` pixels of `image`. */
function crop(image: PNG, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const start = row * image.width * 4;
    out.set(image.data.subarray(start, start + width * 4), row * width * 4);
  }
  return out;
}

/** Nearest-neighbour downscale so the long edge is at most `maxEdge`. */
function downscale(png: Uint8Array, maxEdge: number): Uint8Array {
  const source = PNG.sync.read(Buffer.from(png));
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const target = new PNG({
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  });
  for (let row = 0; row < target.height; row += 1) {
    for (let col = 0; col < target.width; col += 1) {
      const from = (Math.floor(row / scale) * source.width + Math.floor(col / scale)) * 4;
      target.data.set(source.data.subarray(from, from + 4), (row * target.width + col) * 4);
    }
  }
  return new Uint8Array(PNG.sync.write(target));
}
