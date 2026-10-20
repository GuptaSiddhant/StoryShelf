import pixelmatch from "pixelmatch";
import type { ImageCodec, RgbaImage } from "./codec.ts";
import type { DiffOptions, DiffResult } from "./options.ts";
import { pngjsCodec } from "./pngjs.ts";

/**
 * Compare baseline and current screenshots, returning pass/fail and a diff image.
 *
 * @param baseline - Baseline PNG buffer.
 * @param current - Current capture PNG buffer.
 * @param options - Pixel threshold and ratio limits.
 * @param codec - Decodes and encodes the PNGs; pngjs unless an engine says otherwise.
 * @returns The diff result with pixel counts and an optional overlay image.
 */
export async function diffImages(
  baseline: Buffer,
  current: Buffer,
  options: DiffOptions,
  codec: ImageCodec = pngjsCodec,
): Promise<DiffResult> {
  const identical = identicalResult(baseline, current);
  if (identical) {
    return identical;
  }
  const [baselineImage, currentImage] = await Promise.all([
    codec.decode(baseline),
    codec.decode(current),
  ]);
  return await compareImages(baselineImage, currentImage, options, codec);
}

/** Diff two decoded images; a size mismatch fails, or (with `failOnSizeChange: false`) diffs the overlap. */
async function compareImages(
  baseline: RgbaImage,
  current: RgbaImage,
  options: DiffOptions,
  codec: ImageCodec,
): Promise<DiffResult> {
  const baselineDimensions = { width: baseline.width, height: baseline.height };
  const currentDimensions = { width: current.width, height: current.height };
  const sizeChanged =
    baselineDimensions.width !== currentDimensions.width ||
    baselineDimensions.height !== currentDimensions.height;
  if (sizeChanged && options.failOnSizeChange) {
    return {
      passed: false,
      diffPixels: 0,
      diffRatio: 1,
      diffImage: null,
      baselineDimensions,
      currentDimensions,
      sizeChanged,
    };
  }
  // The larger image is cropped to the top-left overlap, which is normalised by its own area.
  const regions = sizeChanged ? overlapRegions(baseline, current) : whole(baseline, current);
  const overlap = await compareRegions(regions, options, codec);
  const diffRatio = overlap.diffPixels / (regions.width * regions.height);
  return {
    passed: diffRatio <= options.maxDiffRatio,
    diffPixels: overlap.diffPixels,
    diffRatio,
    diffImage: overlap.diffImage,
    baselineDimensions,
    currentDimensions,
    sizeChanged,
  };
}

function whole(baseline: RgbaImage, current: RgbaImage): Regions {
  return {
    width: baseline.width,
    height: baseline.height,
    baseline: baseline.data,
    current: current.data,
  };
}

/** Pixelmatch needs equal-size inputs, so both images are cropped to their shared top-left area. */
function overlapRegions(baseline: RgbaImage, current: RgbaImage): Regions {
  const width = Math.min(baseline.width, current.width);
  const height = Math.min(baseline.height, current.height);
  return {
    width,
    height,
    baseline: cropRgba(baseline.data, baseline.width, width, height),
    current: cropRgba(current.data, current.width, width, height),
  };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR_END = 24;

/**
 * Fast path for byte-equal inputs: no decode, no pixelmatch, no overlay.
 *
 * Equal bytes decode to equal pixels, so the diff is empty by construction. Dimensions come from
 * the IHDR chunk (big-endian width/height at bytes 16-23). Inputs that are not recognisably PNG
 * return null so the regular path reports the decode error as before. A direct byte comparison
 * is used instead of hashing both buffers: it is exact and cheaper than two digests.
 */
export function identicalResult(baseline: Buffer, current: Buffer): DiffResult | null {
  if (
    baseline.length < IHDR_END ||
    !baseline.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    !baseline.equals(current)
  ) {
    return null;
  }
  const dimensions = { width: baseline.readUInt32BE(16), height: baseline.readUInt32BE(20) };
  return {
    passed: true,
    diffPixels: 0,
    diffRatio: 0,
    diffImage: null,
    baselineDimensions: dimensions,
    currentDimensions: { ...dimensions },
    sizeChanged: false,
  };
}

function cropRgba(
  source: Uint8Array,
  sourceWidth: number,
  width: number,
  height: number,
): Uint8Array {
  const cropped = new Uint8Array(width * height * 4);
  const rowBytes = width * 4;
  const sourceRowBytes = sourceWidth * 4;
  for (let y = 0; y < height; y += 1) {
    cropped.set(source.subarray(y * sourceRowBytes, y * sourceRowBytes + rowBytes), y * rowBytes);
  }
  return cropped;
}

/** Two same-sized RGBA buffers to compare. */
interface Regions {
  width: number;
  height: number;
  baseline: Uint8Array;
  current: Uint8Array;
}

/**
 * Count differing pixels first without an output buffer; only a failing result pays for the
 * overlay (a second pixelmatch pass plus PNG encode), since passing overlays are discarded.
 */
async function compareRegions(
  { width, height, baseline, current }: Regions,
  options: DiffOptions,
  codec: ImageCodec,
): Promise<{ diffPixels: number; diffImage: Buffer | null }> {
  const matchOptions = {
    threshold: options.pixelThreshold,
    includeAA: options.includeAntialiasing,
  };
  const diffPixels = pixelmatch(baseline, current, undefined, width, height, matchOptions);
  if (diffPixels / (width * height) <= options.maxDiffRatio) {
    return { diffPixels, diffImage: null };
  }
  const overlay: RgbaImage = { width, height, data: new Uint8Array(width * height * 4) };
  pixelmatch(baseline, current, overlay.data, width, height, matchOptions);
  return { diffPixels, diffImage: await codec.encode(overlay) };
}
