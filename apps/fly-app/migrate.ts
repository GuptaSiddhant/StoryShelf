/** One-time copy of the demo's local storage tree to the object storage (Tigris). */
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";

/** What a copy did. */
export interface MigrationResult {
  /** Keys written to the destination (or that a dry run would write). */
  copied: string[];
  /** Keys already in the destination, left alone. */
  skipped: string[];
  /** Keys that are not stored objects: the database files, scratch space, half-written temp files. */
  ignored: string[];
}

/**
 * Whether a local file is a stored object. The SQLite files (`shelf.db`, `-wal`, `-shm`) stay on
 * the volume, the scratch directory is working space, and `.<name>.<uuid>.tmp` is a write in progress.
 */
export function isStoredObject(key: string): boolean {
  const name = key.split("/").at(-1) ?? key;
  return !(
    /^shelf\.db(?:-wal|-shm|-journal)?$/u.test(key) ||
    key.startsWith(".storyshelf-scratch/") ||
    (name.startsWith(".") && name.endsWith(".tmp"))
  );
}

/**
 * Copy every stored object of `from` that `to` does not have yet, by streaming, under the same
 * key (both adapters keep the storage path as the key). Safe to run again: an existing key is
 * skipped, so a run cut short resumes where it stopped. `dryRun` writes nothing.
 */
export async function migrateStorage(
  from: StorageAdapter,
  to: StorageAdapter,
  options: { dryRun?: boolean } = {},
): Promise<MigrationResult> {
  const result: MigrationResult = { copied: [], skipped: [], ignored: [] };
  for (const key of await from.list("")) {
    // One at a time on purpose: a 1 GB machine must not open many streams at once.
    // eslint-disable-next-line no-await-in-loop -- sequential copy
    await copyOne(from, to, key, options, result);
  }
  return result;
}

/** Copy one key if it is a stored object the destination lacks, and record what happened. */
async function copyOne(
  from: StorageAdapter,
  to: StorageAdapter,
  key: string,
  options: { dryRun?: boolean },
  result: MigrationResult,
): Promise<void> {
  if (!isStoredObject(key)) {
    result.ignored.push(key);
  } else if (await to.exists(key)) {
    result.skipped.push(key);
  } else {
    if (options.dryRun !== true) {
      await to.writeStream(key, await from.readStream(key));
    }
    result.copied.push(key);
  }
}
