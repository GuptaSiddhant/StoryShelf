/** Purge for a database with the lifecycle capability: claim each candidate, then finish the deletions. */
import type {
  BuildReferenceLifecycle,
  DatabaseAdapter,
  DeletingBuild,
} from "../adapters/database.ts";
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
  /** Builds finished by this run that an earlier run had already claimed (`deleting` before it). */
  resumedBuilds: number;
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
  const earlier = new Set(
    (await deps.lifecycle.listDeleting(projectId)).map((build) => build.buildId),
  );
  const protectedBuilds = await claimAll(deps, projectId, buildIds);
  const finished = await finishAll(deps, projectId, earlier);
  return { ...finished, protectedBuilds };
}

/** Finish every `deleting` build; `earlier` are the ones already claimed before this run. */
async function finishAll(
  deps: ClaimedPurgeDeps,
  projectId: string,
  earlier: ReadonlySet<string>,
): Promise<Omit<ClaimedPurgeResult, "protectedBuilds">> {
  const total = { removedBuilds: 0, removedFiles: 0, resumedBuilds: 0 };
  for (const build of await deps.lifecycle.listDeleting(projectId)) {
    // oxlint-disable-next-line no-await-in-loop -- one build at a time: SQLite serializes the writes
    const result = await finishOne(deps, projectId, build);
    if (result?.outcome === "deleted") {
      total.removedBuilds += 1;
      if (earlier.has(build.buildId)) total.resumedBuilds += 1;
    }
    total.removedFiles += result?.files ?? 0;
  }
  return total;
}

/** One build's deletion; a failure is logged, leaves the build `deleting`, and yields null. */
async function finishOne(
  deps: ClaimedPurgeDeps,
  projectId: string,
  build: DeletingBuild,
): Promise<Awaited<ReturnType<typeof deleteClaimedBuild>> | null> {
  try {
    return await deleteClaimedBuild(deps, build);
  } catch (error) {
    deps.logger?.warn({ err: error, projectId, buildId: build.buildId }, "build deletion failed");
    return null;
  }
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
    const claim = await claimOne(deps, projectId, buildId);
    if (claim !== "protected") continue;
    protectedBuilds += 1;
    deps.logger?.info(
      { projectId, buildId },
      "build kept: a baseline source or an investigation still references it",
    );
  }
  return protectedBuilds;
}

/** Claim one candidate; a failed claim (for example a write-lock timeout) skips it, not the purge. */
async function claimOne(
  deps: ClaimedPurgeDeps,
  projectId: string,
  buildId: string,
): Promise<string | null> {
  try {
    return await deps.lifecycle.claimDeletion(projectId, buildId);
  } catch (error) {
    deps.logger?.warn({ err: error, projectId, buildId }, "build claim failed");
    return null;
  }
}
