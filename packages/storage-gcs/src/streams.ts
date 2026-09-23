/** Streaming reads/writes for GCS objects, with failure cleanup. */
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { GcsContext } from "./client.ts";
import { gcsKey } from "./keys.ts";

/** Stream `stream` to `path`, deleting the partial object when the pipeline fails. */
export async function gcsWriteStream(
  ctx: GcsContext,
  path: string,
  stream: Readable,
): Promise<void> {
  const file = ctx.bucket.file(gcsKey(ctx.prefix, path));
  const dest = file.createWriteStream({ resumable: false });
  try {
    await pipeline(stream, dest);
  } catch (error) {
    try {
      await file.delete({ ignoreNotFound: true });
    } catch {
      // ignore cleanup failure, rethrow original error
    }
    throw error;
  }
}

/** Open a readable for the bytes at `path`; rejects when the object is missing. */
export async function gcsReadStream(ctx: GcsContext, path: string): Promise<Readable> {
  const file = ctx.bucket.file(gcsKey(ctx.prefix, path));
  const [exists] = await file.exists();
  if (!exists) {
    throw new Error(`No object at "${path}"`);
  }
  return file.createReadStream();
}
