/**
 * The live-manifest guard of content collection (ADR 0039): before a claimed blob is deleted, every
 * live build's manifest is read, and any manifest that names the blob saves it. This is what turns
 * a wrong use record into a leak instead of a delete, so it is never cached across passes and a
 * manifest that cannot be trusted stops the pass.
 */
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import type { Logger } from "../logger.ts";
import { readManifestHashes } from "./build-deletion.ts";

/** How many live manifests one pass reads at a time; the reads are the cost of a pass on a remote store. */
export const MANIFEST_READ_CONCURRENCY = 8;

/** What the scan needs. */
export interface ScanDeps {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  logger?: Logger;
}

/**
 * Take out of `candidates` every hash a live build's manifest names; stops once none is left.
 * Manifests are read {@link MANIFEST_READ_CONCURRENCY} at a time. A read that fails, or a manifest
 * that is not a JSON object, stops the scan and answers false: then no live manifest can be ruled out, so the caller must delete
 * nothing.
 */
export async function dropLiveHashes(deps: ScanDeps, candidates: Set<string>): Promise<boolean> {
  const builds = (await deps.db.list(deps.db.tables.builds)) as unknown as {
    id: string;
    projectId: string;
    retentionState?: string;
  }[];
  const live = builds.filter((build) => build.retentionState !== "deleting");
  const scan = { next: 0, failed: false };
  const lanes = Array.from(
    { length: Math.min(MANIFEST_READ_CONCURRENCY, live.length) },
    async (): Promise<void> => {
      await readLane(deps, live, candidates, scan);
    },
  );
  await Promise.all(lanes);
  if (scan.failed) {
    deps.logger?.warn(
      { candidates: candidates.size, builds: live.length, read: Math.min(scan.next, live.length) },
      "content collection skipped: a build manifest could not be read",
    );
  }
  return !scan.failed;
}

/** One reader of the scan: takes the next build off the shared cursor until done, stopped or failed. */
async function readLane(
  deps: ScanDeps,
  live: { id: string; projectId: string }[],
  candidates: Set<string>,
  scan: { next: number; failed: boolean },
): Promise<void> {
  while (!scan.failed && candidates.size > 0 && scan.next < live.length) {
    const build = live[scan.next];
    scan.next += 1;
    if (!build) return;
    try {
      // oxlint-disable-next-line no-await-in-loop -- a lane reads one manifest at a time
      const hashes = await readManifestHashes(deps, build.projectId, build.id);
      // A manifest that is not a JSON object names nothing we can trust: treat it as a failed read.
      if (hashes === null) scan.failed = true;
      for (const hash of hashes ?? []) candidates.delete(hash);
    } catch {
      scan.failed = true;
    }
  }
}
