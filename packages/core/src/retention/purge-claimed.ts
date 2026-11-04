/** Purge for a database with the lifecycle capability: claim each candidate, then finish the deletions. */
import type { BuildReferenceLifecycle, DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import type { Logger } from "../logger.ts";
import { deleteClaimedBuild, type DeletionStep } from "./build-deletion.ts";

/** What the claimed purge needs; `afterStep` reaches the driver's fault-injection seam. */
export interface ClaimedPurgeDeps {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  lifecycle: BuildReferenceLifecycle;
  logger?: Logger;
  afterStep?: (step: DeletionStep, buildId: string) => Promise<void> | void;
}

/** Counts of what a claimed purge finished. */
export interface ClaimedPurgeResult {
  removedBuilds: number;
  removedFiles: number;
  /** Candidates a baseline or investigation still protects. */
  protectedBuilds: number;
}

/**
 * Claim `buildIds` (a protected build is skipped and logged), then finish every `deleting` build of
 * the project, including ones an earlier run left half done. One build's failure is logged and
 * leaves it `deleting` for the next run; it never stops the others.
 */
export async function purgeClaimedBuilds(
  deps: ClaimedPurgeDeps,
  projectId: string,
  buildIds: readonly string[],
): Promise<ClaimedPurgeResult> {
  const protectedBuilds = await claimAll(deps, projectId, buildIds);
  let removedBuilds = 0;
  let removedFiles = 0;
  for (const build of await deps.lifecycle.listDeleting(projectId)) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- one build at a time: SQLite serializes the writes
      const result = await deleteClaimedBuild(deps, build);
      if (result.outcome === "deleted") removedBuilds += 1;
      removedFiles += result.files;
    } catch (error) {
      deps.logger?.warn({ err: error, projectId, buildId: build.buildId }, "build deletion failed");
    }
  }
  return { removedBuilds, removedFiles, protectedBuilds };
}

/** Claim each candidate; returns how many were protected. */
async function claimAll(
  deps: ClaimedPurgeDeps,
  projectId: string,
  buildIds: readonly string[],
): Promise<number> {
  let protectedBuilds = 0;
  for (const buildId of buildIds) {
    // oxlint-disable-next-line no-await-in-loop -- each claim is its own short transaction
    const claim = await deps.lifecycle.claimDeletion(projectId, buildId);
    if (claim !== "protected") continue;
    protectedBuilds += 1;
    deps.logger?.info(
      { projectId, buildId },
      "build kept: a baseline source or an investigation still references it",
    );
  }
  return protectedBuilds;
}
