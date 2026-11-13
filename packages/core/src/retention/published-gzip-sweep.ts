import type { StorageAdapter } from "../adapters/storage.ts";
import { contentKey } from "../utils/paths.ts";

/** The derived variant families: key prefix and extension (see `publishedGzipPath`, `publishedBrotliPath`). */
const VARIANTS = [
  { prefix: "derived/published-gzip/", extension: ".gz" },
  { prefix: "derived/published-br/", extension: ".br" },
] as const;
const MAX_PER_SWEEP = 128;
const cursors = new WeakMap<StorageAdapter, string>();

/** Reclaim disposable orphan gzip and brotli variants; never delete content or other storage keys. */
export async function sweepPublishedGzip(storage: StorageAdapter): Promise<void> {
  const keys = (
    await Promise.all(VARIANTS.map(async (variant) => await variantKeys(storage, variant)))
  )
    .flat()
    .toSorted();
  if (keys.length === 0) return;
  const cursor = cursors.get(storage);
  const next = cursor ? keys.findIndex((key) => key > cursor) : 0;
  const start = Math.max(0, next);
  const batch = [...keys.slice(start), ...keys.slice(0, start)].slice(0, MAX_PER_SWEEP);
  for (const key of batch) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- bounded, sequential storage work
    await removeOrphan(storage, key);
  }
  const last = batch.at(-1);
  if (last) cursors.set(storage, last);
}

async function variantKeys(
  storage: StorageAdapter,
  variant: (typeof VARIANTS)[number],
): Promise<string[]> {
  const pattern = new RegExp(`^${variant.prefix}[a-f0-9]{64}\\${variant.extension}$`, "u");
  return (await storage.list(variant.prefix)).filter((key) => pattern.test(key));
}

/** The content hash a variant key names: the 64 hex characters before its extension. */
function hashOfKey(key: string): string {
  return key.slice(-67, -3);
}

async function removeOrphan(storage: StorageAdapter, key: string): Promise<void> {
  try {
    if (!(await storage.exists(contentKey(hashOfKey(key))))) await storage.delete(key);
  } catch {
    // Retention is best effort; a missing variant can always be regenerated.
  }
}
