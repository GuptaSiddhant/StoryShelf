import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { Logger } from "pino";
import type { StorageAdapter } from "../adapters/storage.ts";
import type { DatabaseAdapter } from "../db/database.ts";
import { BaselineModel } from "../models/baseline.ts";
import { BuildModel } from "../models/build.ts";
import { LabelModel } from "../models/label.ts";
import { builds } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";
import { TERMINAL_BUILD_STATUSES } from "../types.ts";

/** Removes expired transient builds while keeping baselines and persistent builds. */
export class Retention {
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly storage: StorageAdapter,
    private readonly logger?: Logger,
  ) {}

  async purge(project: Project, options: PurgeOptions): Promise<PurgeResult> {
    const cutoff = new Date(Date.now() - options.ttlDays * 86_400_000).toISOString();
    const candidates = await this.db.list(builds, {
      where: and(
        eq(builds.projectId, project.id),
        inArray(builds.status, [...TERMINAL_BUILD_STATUSES]),
        lt(builds.updatedAt, cutoff),
      ),
    });

    const keep = options.keepLatestPerBranch
      ? await this.latestPerBranch(project.id)
      : new Set<string>();
    const labelModel = new LabelModel(this.db);
    const target = await Promise.all(
      candidates.map(async (build) => {
        if (keep.has(build.id) || (await labelModel.hasPersistent(project.id, build.id))) {
          return null;
        }
        return build.id;
      }),
    );

    const buildIds = target.filter((id): id is string => id !== null);
    const results = await Promise.all(
      buildIds.map(async (buildId) => ({
        files: await this.deleteBuildFiles(project.id, buildId),
        removed: await this.removeBuild(buildId),
      })),
    );
    const removedBuilds = results.filter((r) => r.removed).length;
    const removedFiles = results.reduce((sum, r) => sum + r.files, 0);
    this.logger?.info(
      { projectId: project.id, removedBuilds, removedFiles },
      "build retention purge complete",
    );
    return { removedBuilds, removedFiles };
  }

  private async removeBuild(buildId: string): Promise<boolean> {
    await new BuildModel(this.db).remove(buildId);
    return true;
  }

  private async latestPerBranch(projectId: string): Promise<Set<string>> {
    const rows = await this.db.list(builds, {
      where: eq(builds.projectId, projectId),
      orderBy: desc(builds.updatedAt),
    });
    const latest = new Map<string, string>();
    for (const row of rows) {
      const current = latest.get(row.gitBranch);
      if (!current) {
        latest.set(row.gitBranch, row.id);
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
    return files.length;
  }

  async purgeStaleBranches(project: Project, ttlDays: number): Promise<BranchGcResult> {
    if (ttlDays <= 0) {
      return { removedBranches: 0, removedBaselines: 0 };
    }
    const cutoff = new Date(Date.now() - ttlDays * 86_400_000).toISOString();
    const rows = await this.db.list(builds, {
      where: eq(builds.projectId, project.id),
    });
    const stale = collectStaleBranches(rows, project.gitDefaultBranch, cutoff);
    if (stale.size === 0) {
      return { removedBranches: 0, removedBaselines: 0 };
    }
    const baselines = new BaselineModel(this.db, this.storage);
    const removedBaselines = await baselines.removeStaleBranches(project.id, stale);
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
}

/** Counts of builds and files removed by a retention purge. */
export interface PurgeResult {
  removedBuilds: number;
  removedFiles: number;
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
