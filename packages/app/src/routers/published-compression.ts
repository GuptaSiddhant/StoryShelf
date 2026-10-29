/** Disposable, content-addressed gzip variants of authorized published files. */
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { publishedGzipPath } from "@storyshelf/core/utils";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

const compress = promisify(gzip);
const decompress = promisify(gunzip);
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_JOBS = 2;
const MAX_READS = 4;
const READ_TIMEOUT_MS = 250;
const states = new WeakMap<StorageAdapter, State>();

interface State {
  jobs: Map<string, Promise<void>>;
  reads: number;
}

/** Gzip is chosen only if explicitly accepted, or by a nonzero wildcard. */
export function acceptsGzip(header?: string): boolean {
  if (!header) return false;
  const entries = header.split(",").map((part) => part.trim().split(";"));
  const entry =
    entries.find(([name]) => name?.trim().toLowerCase() === "gzip") ??
    entries.find(([name]) => name?.trim() === "*");
  if (!entry) return false;
  const quality = entry.slice(1).find((part) => /^\s*q\s*=/iu.test(part));
  if (quality === undefined) return true;
  const value = Number(quality.split("=")[1]);
  return Number.isFinite(value) && value > 0 && value <= 1;
}

/** Return a verified existing variant, or the original while a bounded background job runs. */
export async function publishedGzip(
  storage: StorageAdapter,
  hash: string | undefined,
  original: Buffer,
  mime: string,
): Promise<Buffer | undefined> {
  if (typeof hash !== "string" || !eligible(hash, original, mime)) return undefined;
  const state = stateOf(storage);
  if (state.reads >= MAX_READS) return undefined;
  state.reads += 1;
  const read = findVariant(storage, hash, original).finally(() => {
    state.reads -= 1;
  });
  const found = await withDeadline(read);
  if (found === "timeout") return undefined;
  if (found) return found;
  schedule(storage, state, hash, original);
  return undefined;
}

function eligible(hash: string | undefined, original: Buffer, mime: string): boolean {
  return (
    typeof hash === "string" &&
    /^[a-f0-9]{64}$/u.test(hash) &&
    original.length > 0 &&
    original.length <= MAX_FILE_BYTES &&
    /^(?:text\/|application\/(?:javascript|json|xml|wasm)|image\/svg\+xml)/iu.test(mime)
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
): Promise<Buffer | undefined> {
  try {
    const path = publishedGzipPath(hash);
    if (!(await storage.exists(path))) return undefined;
    const bytes = await storage.read(path);
    if (bytes.length === 0 || bytes.length >= original.length) return undefined;
    const decoded = await decompress(bytes, { maxOutputLength: original.length });
    return decoded.equals(original) ? bytes : undefined;
  } catch {
    return undefined;
  }
}

/** No queue: at capacity a future request may try again. */
function schedule(storage: StorageAdapter, state: State, hash: string, original: Buffer): void {
  if (state.jobs.has(hash) || state.jobs.size >= MAX_JOBS) return;
  const job = generate(storage, hash, original)
    .catch(() => {})
    .finally(() => {
      state.jobs.delete(hash);
    });
  state.jobs.set(hash, job);
}

async function generate(storage: StorageAdapter, hash: string, original: Buffer): Promise<void> {
  if (createHash("sha256").update(original).digest("hex") !== hash) return;
  const source = `content/${hash}`;
  if (!(await storage.exists(source))) return;
  const compressed = await compress(original);
  if (compressed.length >= original.length || !(await storage.exists(source))) return;
  const path = publishedGzipPath(hash);
  await storage.write(path, compressed);
  // A purge can remove the original while compression is in flight.
  if (!(await storage.exists(source))) await storage.delete(path);
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
