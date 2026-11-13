import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import type { Logger } from "pino";
import type { BuildReferenceLifecycle, DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { BaselineModel } from "../models/baseline.ts";
import { BuildComponentModel } from "../models/build-component.ts";
import { BuildModel, type BuildTables } from "../models/build.ts";
import { CaptureJobModel } from "../models/capture-job.ts";
import { InsightModel } from "../models/insight.ts";
import { LabelModel, type LabelTables } from "../models/label.ts";
import { PackageUsageModel } from "../models/usage.ts";
import type { Project } from "../schema/project.ts";
import { TERMINAL_BUILD_STATUSES } from "../types.ts";
import { collectUnreferencedContent } from "./content-gc.ts";
import { pendingCandidates } from "./pending.ts";
import { sweepPublishedGzip } from "./published-gzip-sweep.ts";
import { purgeClaimedBuilds } from "./purge-claimed.ts";
import { sweepScreenshotContent } from "./screenshot-sweep.ts";

export {
  sweepScreenshotContent,
  SWEEP_GRACE_MS,
  type SweepDeps,
  type SweepResult,
  type SweepTables,
} from "./screenshot-sweep.ts";
import { col } from "../models/columns.ts";
export { purgeAiData, STALE_RUN_MS, type AiPurgeResult, type AiRetention } from "./ai.ts";
export {
  deleteClaimedBuild,
  type BuildDeletionDeps,
  type BuildDeletionResult,
  type DeletionStep,
} from "./build-deletion.ts";
export {
  CONTENT_BACKFILL_KEY,
  CONTENT_BACKFILL_PAGE,
  backfillContentUses,
  type ContentBackfillDeps,
  type ContentBackfillResult,
} from "./content-backfill.ts";
export { CONTENT_GRACE_MS, collectUnreferencedContent, type ContentGcDeps } from "./content-gc.ts";
export {
  purgeClaimedBuilds,
  type ClaimedPurgeDeps,
  type ClaimedPurgeResult,
} from "./purge-claimed.ts";

/** Table handles for retention queries. */
export interface RetentionTables {
  builds: Table;
  buildLabels: Table;
  baselines: Table;
}

/** Removes expired transient builds while keeping baselines and persistent builds. */
export class Retention {
  private readonly db: DatabaseAdapter;
  private readonly storage: StorageAdapter;
  private readonly tables: RetentionTables;
  private readonly logger?: Logger;

  constructor(
    db: DatabaseAdapter,
    storage: StorageAdapter,
    tables: RetentionTables,
    logger?: Logger,
  ) {
    this.db = db;
    this.storage = storage;
    this.tables = tables;
    this.logger = logger;
  }

  async purge(project: Project, options: PurgeOptions): Promise<PurgeResult> {
    // Resolved once, before anything is awaited: a capability that is cleared while the candidates
    // are selected (a setup rerun) must not turn this pass into an unfenced one (ADR 0039).
    // An explicit `lifecycle` (even `undefined`: the caller found none) is the pass's snapshot;
    // only a caller that gave no option at all gets the database's capability read here.
    const lifecycle = "lifecycle" in options ? options.lifecycle : this.db.buildReferenceLifecycle;
    const cutoff = new Date(Date.now() - options.ttlDays * 86_400_000).toISOString();
    const { buildIds, pending } = await this.selectBuilds(project, options, cutoff);
    if (lifecycle) return await this.purgeClaimed(project, lifecycle, buildIds, pending, cutoff);
    return await this.purgeUnfenced(project, buildIds, pending, cutoff);
  }

  /** Purge without the lifecycle capability: delete each build's files, then its rows. */
  private async purgeUnfenced(
    project: Project,
    buildIds: readonly string[],
    pending: number,
    cutoff: string,
  ): Promise<PurgeResult> {
    const results = await Promise.all(
      buildIds.map(async (buildId) => ({
        files: await this.deleteBuildFiles(project.id, buildId),
        removed: await this.removeBuild(buildId),
      })),
    );
    const removedBuilds = results.filter((r: { removed: boolean }) => r.removed).length;
    const removedFiles = results.reduce((sum: number, r: { files: number }) => sum + r.files, 0);
    await this.sweepScreenshots(project);
    const removedJobs = await this.purgeFinishedJobs(cutoff);
    this.logger?.info(
      { projectId: project.id, removedBuilds, removedFiles, removedJobs, removedPending: pending },
      "build retention purge complete",
    );
    return { removedBuilds, removedFiles };
  }

  /**
   * Purge through the lifecycle capability: claim each candidate (a protected one stays), then
   * finish the deletions with durable progress (ADR 0039). Content is collected once at the end.
   */
  private async purgeClaimed(
    project: Project,
    lifecycle: BuildReferenceLifecycle,
    buildIds: readonly string[],
    pending: number,
    cutoff: string,
  ): Promise<PurgeResult> {
    const deps = { db: this.db, storage: this.storage, lifecycle, logger: this.logger };
    const claimed = await purgeClaimedBuilds(deps, project.id, buildIds);
    await collectUnreferencedContent(deps).catch((error: unknown) => {
      this.logger?.warn({ err: error, projectId: project.id }, "content collection failed");
    });
    await sweepPublishedGzip(this.storage).catch(() => {});
    await this.sweepScreenshots(project);
    const removedJobs = await this.purgeFinishedJobs(cutoff);
    this.logger?.info(
      { projectId: project.id, ...claimed, removedJobs, removedPending: pending },
      "build retention purge complete",
    );
    return {
      removedBuilds: claimed.removedBuilds,
      removedFiles: claimed.removedFiles,
      protectedBuilds: claimed.protectedBuilds,
      resumedBuilds: claimed.resumedBuilds,
    };
  }

  /**
   * The builds a purge removes: terminal builds past the window (minus the latest per branch when
   * asked), and pending builds idle past it (ADR 0013, decision 9). Persistent builds stay.
   */
  private async selectBuilds(
    project: Project,
    options: PurgeOptions,
    cutoff: string,
  ): Promise<{ buildIds: string[]; pending: number }> {
    const candidates = await this.db.list(this.tables.builds, {
      where: and(
        eq(col(this.tables.builds, "projectId"), project.id),
        inArray(col(this.tables.builds, "status"), [...TERMINAL_BUILD_STATUSES]),
        lt(col(this.tables.builds, "updatedAt"), cutoff),
      ),
    });
    const keep = options.keepLatestPerBranch
      ? await this.latestPerBranch(project.id)
      : new Set<string>();
    const persistent = await new LabelModel(
      this.db,
      this.tables as unknown as LabelTables,
    ).persistentBuildIds(project.id);
    const terminal = candidates
      .map((build) => (build as { id: string }).id)
      .filter((buildId) => !keep.has(buildId));
    // Pending builds leave on their own clock; "the latest on a branch" does not shield them.
    const pending = (await pendingCandidates(this.db, project.id, cutoff)).map(
      (candidate) => candidate.buildId,
    );
    return {
      buildIds: [...terminal, ...pending].filter((buildId) => !persistent.has(buildId)),
      pending: pending.length,
    };
  }

  /** Reclaim screenshots no snapshot or baseline references any more; never blocks the purge. */
  private async sweepScreenshots(project: Project): Promise<void> {
    try {
      await sweepScreenshotContent(
        {
          db: this.db,
          storage: this.storage,
          tables: {
            snapshots: this.db.tables.snapshots,
            baselines: this.tables.baselines,
            builds: this.tables.builds,
          },
          logger: this.logger,
        },
        project.id,
      );
    } catch (error) {
      this.logger?.warn({ err: error, projectId: project.id }, "screenshot sweep failed");
    }
  }

  /**
   * Drop finished queue jobs older than the build cutoff (they have no foreign key to a build, and
   * a finished job is only history); never blocks the purge. Queued and running jobs are kept.
   */
  private async purgeFinishedJobs(cutoff: string): Promise<number> {
    try {
      return await new CaptureJobModel(this.db).purgeFinished(cutoff);
    } catch (error) {
      this.logger?.warn({ err: error }, "capture job purge failed");
      return 0;
    }
  }

  private async removeBuild(buildId: string): Promise<boolean> {
    await new InsightModel(this.db).removeForBuild(buildId);
    await new CaptureJobModel(this.db).removeForBuild(buildId);
    await new BuildComponentModel(this.db).removeForBuild(buildId);
    await new PackageUsageModel(this.db).removeForBuild(buildId);
    await new BuildModel(this.db, this.tables as unknown as BuildTables).remove(buildId);
    return true;
  }

  private async latestPerBranch(projectId: string): Promise<Set<string>> {
    const rows = (await this.db.list(this.tables.builds, {
      where: eq(col(this.tables.builds, "projectId"), projectId),
      orderBy: desc(col(this.tables.builds, "updatedAt")),
    })) as unknown as { gitBranch: string; id: string }[];
    const latest = new Map<string, string>();
    for (const row of rows) {
      const branch = row.gitBranch;
      const current = latest.get(branch);
      if (!current) {
        latest.set(branch, row.id);
      }
    }
    return new Set(latest.values());
  }

  private async deleteBuildFiles(projectId: string, buildId: string): Promise<number> {
    const prefix = `${projectId}/builds/${buildId}/`;
    const files = await this.storage.list(prefix);
    await Promise.all(
      files.map(async (file) => {
        await this.storage.delete(file);
      }),
    );
    await sweepPublishedGzip(this.storage).catch(() => {});
    return files.length;
  }

  /** The branches (never the default one) whose newest build is older than the window. */
  private async staleBranches(project: Project, ttlDays: number): Promise<Set<string>> {
    const cutoff = new Date(Date.now() - ttlDays * 86_400_000).toISOString();
    const rows = (await this.db.list(this.tables.builds, {
      where: eq(col(this.tables.builds, "projectId"), project.id),
    })) as unknown as { gitBranch: string; updatedAt: string }[];
    return collectStaleBranches(rows, project.gitDefaultBranch, cutoff);
  }

  async purgeStaleBranches(project: Project, ttlDays: number): Promise<BranchGcResult> {
    if (ttlDays <= 0) {
      return { removedBranches: 0, removedBaselines: 0 };
    }
    const stale = await this.staleBranches(project, ttlDays);
    if (stale.size === 0) {
      return { removedBranches: 0, removedBaselines: 0 };
    }
    const baselines = new BaselineModel(this.db, this.tables, this.storage);
    const removedBaselines = await baselines.removeStaleBranches(project.id, stale);
    await this.sweepScreenshots(project);
    this.logger?.info(
      { projectId: project.id, removedBranches: stale.size, removedBaselines },
      "branch GC complete",
    );
    return { removedBranches: stale.size, removedBaselines };
  }
}

/** Options controlling which builds a retention purge removes. */
export interface PurgeOptions {
  ttlDays: number;
  keepLatestPerBranch: boolean;
  /**
   * The capability the caller resolved at the start of its pass, shared by every project of that
   * pass. Without it the purge reads the database's capability when it starts, and never again.
   */
  lifecycle?: BuildReferenceLifecycle | undefined;
}

/** Counts of builds and files removed by a retention purge. */
export interface PurgeResult {
  removedBuilds: number;
  removedFiles: number;
  /** With the lifecycle capability: candidates a baseline or investigation still protects. */
  protectedBuilds?: number;
  /** With the lifecycle capability: removed builds an earlier, unfinished run had claimed. */
  resumedBuilds?: number;
}

/** Counts of stale branches and baselines removed. */
export interface BranchGcResult {
  removedBranches: number;
  removedBaselines: number;
}

function collectStaleBranches(
  rows: { gitBranch: string; updatedAt: string }[],
  defaultBranch: string,
  cutoff: string,
): Set<string> {
  const latestAt = branchLatestAt(rows);
  const stale = new Set<string>();
  for (const [branch, updatedAt] of latestAt) {
    if (branch !== defaultBranch && updatedAt < cutoff) {
      stale.add(branch);
    }
  }
  return stale;
}

function branchLatestAt(rows: { gitBranch: string; updatedAt: string }[]): Map<string, string> {
  const latestAt = new Map<string, string>();
  for (const row of rows) {
    const current = latestAt.get(row.gitBranch);
    if (!current || row.updatedAt > current) {
      latestAt.set(row.gitBranch, row.updatedAt);
    }
  }
  return latestAt;
}
