/** The optional native codec: libvips via `sharp`. Several times faster than pngjs on large PNGs. */
import type { ImageCodec, RgbaImage } from "./codec.ts";

type SharpModule = typeof import("sharp");

/**
 * Load `sharp` and build the codec. Throws a readable error when the optional peer is missing
 * or has no binary for this platform, so a misconfigured engine fails at boot, not mid-build.
 */
export async function createSharpCodec(): Promise<ImageCodec> {
  const sharp = await importSharp();
  return {
    name: "sharp",
    decode: async (png) => await decodeWithSharp(sharp, png),
    encode: async (image) => await encodeWithSharp(sharp, image),
    downscale: async (png, maxEdge) => await downscaleWithSharp(sharp, png, maxEdge),
  };
}

async function importSharp(): Promise<SharpModule["default"]> {
  try {
    return (await import("sharp")).default;
  } catch (error) {
    throw new Error(
      'images.engine "sharp" needs the optional `sharp` package: install it next to StoryShelf (e.g. `nub add sharp`).',
      { cause: error },
    );
  }
}

async function decodeWithSharp(sharp: SharpModule["default"], png: Buffer): Promise<RgbaImage> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

/**
 * Encode RGBA as a PNG. The result is copied: libvips hands back a Buffer over external native
 * memory, which a worker cannot transfer to the pool (`DataCloneError`).
 */
async function encodeWithSharp(
  sharp: SharpModule["default"],
  { width, height, data }: RgbaImage,
): Promise<Buffer> {
  const encoded = await sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  return Buffer.from(encoded);
}

async function downscaleWithSharp(
  sharp: SharpModule["default"],
  png: Uint8Array,
  maxEdge: number,
): Promise<Uint8Array> {
  const out = await sharp(png)
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  return new Uint8Array(out);
}
