import type { StorageAdapter } from "../adapters/storage.ts";

const PREFIX = "derived/published-gzip/";
const MAX_PER_SWEEP = 128;
const cursors = new WeakMap<StorageAdapter, string>();

/** Reclaim disposable orphan variants; never delete content or other storage keys. */
export async function sweepPublishedGzip(storage: StorageAdapter): Promise<void> {
  const keys = (await storage.list(PREFIX))
    .filter((key) => /^derived\/published-gzip\/[a-f0-9]{64}\.gz$/u.test(key))
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

async function removeOrphan(storage: StorageAdapter, key: string): Promise<void> {
  const hash = key.slice(PREFIX.length, -3);
  try {
    if (!(await storage.exists(`content/${hash}`))) await storage.delete(key);
  } catch {
    // Retention is best effort; a missing variant can always be regenerated.
  }
}
