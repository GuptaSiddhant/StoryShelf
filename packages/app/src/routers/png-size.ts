import type { Readable } from "node:stream";
import { getStore } from "../store.ts";

/** A PNG's natural size in pixels, read from its header. */
export interface PngSize {
  width: number;
  height: number;
}

/** Bytes up to the end of the IHDR chunk's width and height (big-endian at 16 and 20). */
const HEADER_BYTES = 24;
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The size a PNG declares in its IHDR chunk; null when the bytes are not a PNG header. */
export function pngSizeOf(bytes: Buffer): PngSize | null {
  if (
    bytes.length < HEADER_BYTES ||
    !bytes.subarray(0, SIGNATURE.length).equals(SIGNATURE) ||
    bytes.toString("latin1", 12, 16) !== "IHDR"
  ) {
    return null;
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** The first `HEADER_BYTES` of a stream; the rest is never read. */
async function headOf(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      chunks.push(bytes);
      length += bytes.length;
      if (length >= HEADER_BYTES) break;
    }
  } finally {
    stream.destroy();
  }
  return Buffer.concat(chunks);
}

/**
 * The natural size of the PNG stored at `path`, from its header alone. Null when it is missing,
 * unreadable or not a PNG: the comparison then falls back to scaling each image on its own.
 */
export async function readPngSize(path: string): Promise<PngSize | null> {
  try {
    return pngSizeOf(await headOf(await getStore().storage.readStream(path)));
  } catch {
    return null;
  }
}
