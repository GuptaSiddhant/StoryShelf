/** Image codecs: how PNGs become raw RGBA pixels and back. The comparison itself is always pixelmatch. */

/** Engine names accepted by `images.engine` and `SHELF_IMAGE_ENGINE`. */
export const IMAGE_ENGINES = ["pngjs", "sharp"] as const;

/** A codec that can decode, encode and downscale PNGs. */
export type ImageEngineName = (typeof IMAGE_ENGINES)[number];

export { IMAGE_ENGINE_ENV } from "@storyshelf/core/adapter/capture-runner";

/** The engine used when nothing is configured: pure JavaScript, runs anywhere. */
export const DEFAULT_IMAGE_ENGINE: ImageEngineName = "pngjs";

/** Raw 8-bit RGBA pixels, row-major, `width * height * 4` bytes. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Everything the engine needs from an image library. */
export interface ImageCodec {
  readonly name: ImageEngineName;
  /** Decode a PNG to RGBA. */
  decode(png: Buffer): Promise<RgbaImage> | RgbaImage;
  /** Encode RGBA pixels as a PNG. */
  encode(image: RgbaImage): Promise<Buffer> | Buffer;
  /** Downscale a PNG so its long edge is at most `maxEdge`; output stays PNG. */
  downscale(png: Uint8Array, maxEdge: number): Promise<Uint8Array> | Uint8Array;
}

/** Narrow an arbitrary string to a known engine name. */
export function isImageEngine(value: unknown): value is ImageEngineName {
  return IMAGE_ENGINES.some((engine) => engine === value);
}

/**
 * The engine named by a raw setting (an option or the `SHELF_IMAGE_ENGINE` value); blank or
 * missing means the default. An unknown name throws so a typo cannot silently fall back.
 */
export function resolveImageEngine(raw: string | undefined): ImageEngineName {
  const value = raw?.trim();
  if (value === undefined || value === "") {
    return DEFAULT_IMAGE_ENGINE;
  }
  if (!isImageEngine(value)) {
    throw new Error(`Unknown image engine "${value}". Use one of: ${IMAGE_ENGINES.join(", ")}.`);
  }
  return value;
}
