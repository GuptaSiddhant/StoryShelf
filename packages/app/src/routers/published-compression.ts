/** Disposable, content-addressed gzip and brotli variants of authorized published files. */
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { contentKey, publishedBrotliPath, publishedGzipPath } from "@storyshelf/core/utils";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { brotliCompress, brotliDecompress, constants, gunzip, gzip } from "node:zlib";
import type { VariantEncoding } from "./accept-encoding.ts";

/** How each encoding is stored, made and checked. Brotli quality 9 is near 11 at far less CPU. */
const CODECS = {
  gzip: {
    path: publishedGzipPath,
    compress: promisify(gzip) as (input: Buffer) => Promise<Buffer>,
    decompress: promisify(gunzip) as (
      input: Buffer,
      o: { maxOutputLength: number },
    ) => Promise<Buffer>,
  },
  br: {
    path: publishedBrotliPath,
    compress: async (input: Buffer): Promise<Buffer> =>
      await promisify(brotliCompress)(input, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: 9,
          [constants.BROTLI_PARAM_SIZE_HINT]: input.length,
        },
      }),
    decompress: promisify(brotliDecompress) as (
      input: Buffer,
      o: { maxOutputLength: number },
    ) => Promise<Buffer>,
  },
} as const;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_JOBS = 2;
const MAX_READS = 4;
const READ_TIMEOUT_MS = 250;
const states = new WeakMap<StorageAdapter, State>();

interface State {
  jobs: Map<string, Promise<void>>;
  reads: number;
}

/** The verified gzip variant of a file, or the original (`undefined`) while a background job runs. */
export async function publishedGzip(
  storage: StorageAdapter,
  hash: string | undefined,
  original: Buffer,
  mime: string,
): Promise<Buffer | undefined> {
  return await publishedVariant(storage, hash, original, mime, "gzip");
}

/** Return a verified existing variant, or the original while a bounded background job runs. */
export async function publishedVariant(
  storage: StorageAdapter,
  hash: string | undefined,
  original: Buffer,
  mime: string,
  encoding: VariantEncoding,
): Promise<Buffer | undefined> {
  if (typeof hash !== "string" || !eligible(hash, original, mime)) return undefined;
  const state = stateOf(storage);
  if (state.reads >= MAX_READS) return undefined;
  state.reads += 1;
  const read = findVariant(storage, hash, original, encoding).finally(() => {
    state.reads -= 1;
  });
  const found = await withDeadline(read);
  if (found === "timeout") return undefined;
  if (found) return found;
  schedule(storage, state, hash, original, encoding);
  return undefined;
}

/** Whether a MIME type is one worth compressing (text-like); size is checked once the bytes are read. */
export function isCompressible(mime: string): boolean {
  return /^(?:text\/|application\/(?:javascript|json|xml|wasm)|image\/svg\+xml)/iu.test(mime);
}

/** Whether `original` is worth a variant: a content hash, text-like, not empty and not oversized. */
export function eligible(hash: string | undefined, original: Buffer, mime: string): boolean {
  return (
    typeof hash === "string" &&
    /^[a-f0-9]{64}$/u.test(hash) &&
    original.length > 0 &&
    original.length <= MAX_FILE_BYTES &&
    isCompressible(mime)
  );
}

function stateOf(storage: StorageAdapter): State {
  let state = states.get(storage);
  if (!state) {
    state = { jobs: new Map(), reads: 0 };
    states.set(storage, state);
  }
  return state;
}

async function findVariant(
  storage: StorageAdapter,
  hash: string,
  original: Buffer,
  encoding: VariantEncoding,
): Promise<Buffer | undefined> {
  try {
    const codec = CODECS[encoding];
    const path = codec.path(hash);
    if (!(await storage.exists(path))) return undefined;
    const bytes = await readBounded(storage, path, original.length);
    if (!bytes || bytes.length === 0) return undefined;
    const decoded = await codec.decompress(bytes, { maxOutputLength: original.length });
    return decoded.equals(original) ? bytes : undefined;
  } catch {
    return undefined;
  }
}

/** Do not allocate an unbounded buffer when a damaged storage object is oversized. */
async function readBounded(
  storage: StorageAdapter,
  path: string,
  limit: number,
): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of await storage.readStream(path)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size >= limit) {
      return undefined;
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size);
}

/** No queue: at capacity a future request may try again. */
function schedule(
  storage: StorageAdapter,
  state: State,
  hash: string,
  original: Buffer,
  encoding: VariantEncoding,
): void {
  const id = `${encoding}:${hash}`;
  if (state.jobs.has(id) || state.jobs.size >= MAX_JOBS) return;
  const job = generate(storage, hash, original, encoding)
    .catch(() => {})
    .finally(() => {
      state.jobs.delete(id);
    });
  state.jobs.set(id, job);
}

/**
 * Write one variant of `original` when it is smaller than the original and its source blob still
 * exists. Used by the first-request fallback and by publish-time generation (`published-precompress`).
 */
export async function generate(
  storage: StorageAdapter,
  hash: string,
  original: Buffer,
  encoding: VariantEncoding,
): Promise<void> {
  if (createHash("sha256").update(original).digest("hex") !== hash) return;
  const source = contentKey(hash);
  if (!(await storage.exists(source))) return;
  const codec = CODECS[encoding];
  const path = codec.path(hash);
  const compressed = await codec.compress(original);
  if (compressed.length >= original.length || !(await storage.exists(source))) return;
  await storage.write(path, compressed);
  // A purge can remove the original while compression is in flight.
  if (!(await storage.exists(source))) await storage.delete(path);
}

/** Whether a variant is already stored (by key only; a damaged one is replaced on first use). */
export async function hasVariant(
  storage: StorageAdapter,
  hash: string,
  encoding: VariantEncoding,
): Promise<boolean> {
  return await storage.exists(CODECS[encoding].path(hash));
}

async function withDeadline<T>(promise: Promise<T>): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => {
          resolve("timeout");
        }, READ_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
