/** Recompute a build's diffs against the baselines that apply now, without re-rendering. */
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import type { Logger } from "../logger.ts";
import { NO_BASELINE } from "../models/baseline-status.ts";
import { BaselineModel } from "../models/baseline.ts";
import { SnapshotModel } from "../models/snapshot.ts";
import type { Baseline } from "../schema/baseline.ts";
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";
import type { Snapshot } from "../schema/snapshot.ts";
import { mapLimit } from "../utils/map-limit.ts";
import { diffPath } from "../utils/paths.ts";
import {
  freezeComparison,
  isComparisonImagePath,
  parseComparisonReference,
  sourceSnapshotId,
} from "./comparison-reference.ts";
import { diffStoredScreenshots, writeDiffOverlay } from "./diff-record.ts";
import { diffStatus, PERSIST_CONCURRENCY } from "./pipeline.ts";

/** Dependencies for {@link rediffBuild}. */
export interface RediffDeps {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  logger?: Logger;
}

/** Outcome of a re-diff run. */
export interface RediffResult {
  /** Snapshots diffed against their current baseline. */
  rediffed: number;
  /** Snapshots whose status changed (for example `changed` to `unchanged`). */
  statusChanged: number;
  /** Snapshot ids skipped because their stored screenshot is gone. */
  missingScreenshots: string[];
}

/** Build statuses a re-diff may run in; earlier or failed builds have no complete snapshot set. */
export const REDIFFABLE_BUILD_STATUSES: ReadonlySet<string> = new Set([
  "reviewing",
  "approved",
  "rejected",
]);

const REDIFFABLE_SNAPSHOT_STATUSES: ReadonlySet<string> = new Set(["new", "changed", "unchanged"]);

/**
 * Re-diff the build's undecided snapshots against the baselines that apply today.
 *
 * Approved and rejected snapshots are decisions and stay untouched; inherited snapshots were never
 * rendered. The caller refreshes the build rollup afterwards.
 */
export async function rediffBuild(
  deps: RediffDeps,
  project: Project,
  build: Build,
): Promise<RediffResult> {
  const snapshots = new SnapshotModel(deps.db);
  const rows = (await snapshots.listByBuild(build.id)).filter(
    (row) => !row.inherited && REDIFFABLE_SNAPSHOT_STATUSES.has(row.status),
  );
  const outcomes = await mapLimit(
    rows,
    PERSIST_CONCURRENCY,
    async (row) => await rediffSnapshot(deps, project, build, row),
  );
  const result: RediffResult = {
    rediffed: outcomes.filter((outcome) => outcome !== "missing").length,
    statusChanged: outcomes.filter((outcome) => outcome === "changed").length,
    missingScreenshots: rows
      .filter((_row, index) => outcomes[index] === "missing")
      .map((row) => row.id),
  };
  deps.logger?.info({ buildId: build.id, ...result }, "build re-diffed against current baselines");
  return result;
}

type Outcome = "same" | "changed" | "missing";

async function rediffSnapshot(
  deps: RediffDeps,
  project: Project,
  build: Build,
  row: Snapshot,
): Promise<Outcome> {
  if (!(await deps.storage.exists(row.screenshotPath))) {
    return "missing";
  }
  const baseline = await new BaselineModel(deps.db).resolve(
    project.id,
    row.storyId,
    row.viewportName,
    build.gitBranch,
    project.gitDefaultBranch,
    row.browser,
  );
  const patch = baseline ? await diffPatch(deps, project, build, row, baseline) : noBaselinePatch();
  await new SnapshotModel(deps.db).update(row.id, patch);
  if (
    row.comparisonImagePath &&
    row.comparisonImagePath !== patch.comparisonImagePath &&
    isComparisonImagePath(row.comparisonImagePath, project.id, build.id)
  ) {
    await deps.storage.delete(row.comparisonImagePath).catch(() => {});
  }
  return patch.status === row.status ? "same" : "changed";
}

function noBaselinePatch(): Partial<Snapshot> {
  return {
    status: "new",
    diffPath: null,
    diffPixels: null,
    diffRatio: null,
    diffPassed: null,
    baselineId: null,
    baselineVersion: NO_BASELINE,
    comparisonImagePath: null,
    comparisonMetadata: null,
  };
}

async function diffPatch(
  deps: RediffDeps,
  project: Project,
  build: Build,
  row: Snapshot,
  baseline: Baseline,
): Promise<Partial<Snapshot>> {
  const comparison = await freezeComparison(deps.storage, project.id, build.id, baseline, {
    defaultBranch: project.gitDefaultBranch,
    mode: row.mode ?? null,
    target: row.browser ?? "chromium",
    width: row.viewportWidth ?? null,
    height: row.viewportHeight ?? null,
    captureFingerprint:
      parseComparisonReference(row.comparisonMetadata)?.captureFingerprint ?? null,
    sourceSnapshotId: await sourceSnapshotId(deps.db, baseline),
  });
  const result = await diffStoredScreenshots(
    deps.storage,
    project,
    baseline.screenshotPath === row.screenshotPath
      ? row.screenshotPath
      : comparison.comparisonImagePath,
    row.screenshotPath,
  );
  const target = diffPath(project.id, build.id, row.storyId, row.viewportName, row.browser);
  const overlay = await writeDiffOverlay(deps.storage, target, result, result.passed);
  return {
    status: diffStatus(result.passed, false),
    diffPath: overlay,
    diffPixels: result.diffPixels,
    diffRatio: result.diffRatio,
    diffPassed: result.passed,
    baselineId: baseline.id,
    baselineVersion: baseline.updatedAt,
    ...comparison,
  };
}
