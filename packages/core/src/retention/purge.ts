import { and, desc, eq, getTableColumns, inArray, lt } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { Logger } from "pino";
import type { StorageAdapter } from "../adapters/storage.ts";
import type { DatabaseAdapter } from "../db/database.ts";
import { BaselineModel } from "../models/baseline.ts";
import { BuildModel, type BuildTables } from "../models/build.ts";
import { LabelModel, type LabelTables } from "../models/label.ts";
import type { Project } from "../schema/project.ts";
import { TERMINAL_BUILD_STATUSES } from "../types.ts";

/** Table handles for retention queries. */
export interface RetentionTables {
  builds: Table;
  buildLabels: Table;
  baselines: Table;
}

/** Removes expired transient builds while keeping baselines and persistent builds. */
export class Retention {
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly storage: StorageAdapter,
    private readonly tables: RetentionTables,
    private readonly logger?: Logger,
  ) {}

  async purge(project: Project, options: PurgeOptions): Promise<PurgeResult> {
    const cutoff = new Date(Date.now() - options.ttlDays * 86_400_000).toISOString();
    const candidates = await this.db.list(this.tables.builds, {
      where: and(
        eq(getTableColumns(this.tables.builds)["projectId"] as unknown as SQLWrapper, project.id),
        inArray(getTableColumns(this.tables.builds)["status"] as unknown as SQLWrapper, [
          ...TERMINAL_BUILD_STATUSES,
        ]),
        lt(getTableColumns(this.tables.builds)["updatedAt"] as unknown as SQLWrapper, cutoff),
      ),
    });

    const keep = options.keepLatestPerBranch
      ? await this.latestPerBranch(project.id)
      : new Set<string>();
    const labelModel = new LabelModel(this.db, this.tables as unknown as LabelTables);
    const target = await Promise.all(
      candidates.map(async (build) => {
        const buildId = (build as { id: string }).id;
        if (keep.has(buildId) || (await labelModel.hasPersistent(project.id, buildId))) {
          return null;
        }
        return buildId;
      }),
    );

    const buildIds = target.filter((id): id is string => id !== null);
    const results = await Promise.all(
      buildIds.map(async (buildId) => ({
        files: await this.deleteBuildFiles(project.id, buildId),
        removed: await this.removeBuild(buildId),
      })),
    );
    const removedBuilds = results.filter((r: { removed: boolean }) => r.removed).length;
    const removedFiles = results.reduce((sum: number, r: { files: number }) => sum + r.files, 0);
    this.logger?.info(
      { projectId: project.id, removedBuilds, removedFiles },
      "build retention purge complete",
    );
    return { removedBuilds, removedFiles };
  }

  private async removeBuild(buildId: string): Promise<boolean> {
    await new BuildModel(this.db, this.tables as unknown as BuildTables).remove(buildId);
    return true;
  }

  private async latestPerBranch(projectId: string): Promise<Set<string>> {
    const rows = (await this.db.list(this.tables.builds, {
      where: eq(
        getTableColumns(this.tables.builds)["projectId"] as unknown as SQLWrapper,
        projectId,
      ),
      orderBy: desc(getTableColumns(this.tables.builds)["updatedAt"] as unknown as SQLWrapper),
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
    const manifestPath = `${prefix}storybook/manifest.json`;
    let manifestFiles: string[] = [];
    try {
      if (await this.storage.exists(manifestPath)) {
        const raw = await this.storage.read(manifestPath);
        const manifest = JSON.parse(raw.toString("utf8")) as Record<string, string>;
        manifestFiles = Object.values(manifest);
      }
    } catch {
      // ignore — manifest may not exist for old builds
    }
    const files = await this.storage.list(prefix);
    await Promise.all(
      files.map(async (file) => {
        await this.storage.delete(file);
      }),
    );
    // Decrement content refs for this build's manifest
    for (const hash of manifestFiles) {
      try {
        const { contentRefs } = await import("@storyshelf/db-sqlite/schema");
        const existing = await this.db.get(contentRefs as never, hash);
        // oxlint-disable-next-line unicorn/prefer-ternary -- refCount check is clearer as if/else
        if (existing) {
          const refCount = (existing as { refCount: number }).refCount;
          // oxlint-disable-next-line unicorn/prefer-ternary -- grace logic is clearer as if/else
          if (refCount <= 1) {
            // Keep for 7-day grace: set refCount 0 and update lastSeenAt, don't delete yet
            await this.db.update(contentRefs as never, hash, {
              refCount: 0,
              lastSeenAt: new Date().toISOString(),
            } as never);
          } else {
            await this.db.update(contentRefs as never, hash, {
              refCount: refCount - 1,
              lastSeenAt: new Date().toISOString(),
            } as never);
          }
        }
      } catch {
        // ignore — content_refs may not exist
      }
    }
    // GC stale content_refs with 7-day grace
    try {
      const { contentRefs } = await import("@storyshelf/db-sqlite/schema");
      const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const all = (await this.db.list(contentRefs as never)) as unknown as {
        hash: string;
        refCount: number;
        lastSeenAt: string;
      }[];
      for (const row of all) {
        if (row.refCount === 0 && row.lastSeenAt < cutoff) {
          await this.storage.delete(`content/${row.hash}`).catch(() => {
            // ignore storage delete failure
          });
          await this.db.remove(contentRefs as never, row.hash);
        }
      }
    } catch {
      // ignore — content_refs may not exist
    }
    return files.length;
  }

  async purgeStaleBranches(project: Project, ttlDays: number): Promise<BranchGcResult> {
    if (ttlDays <= 0) {
      return { removedBranches: 0, removedBaselines: 0 };
    }
    const cutoff = new Date(Date.now() - ttlDays * 86_400_000).toISOString();
    const rows = (await this.db.list(this.tables.builds, {
      where: eq(
        getTableColumns(this.tables.builds)["projectId"] as unknown as SQLWrapper,
        project.id,
      ),
    })) as unknown as { gitBranch: string; updatedAt: string }[];
    const stale = collectStaleBranches(rows, project.gitDefaultBranch, cutoff);
    if (stale.size === 0) {
      return { removedBranches: 0, removedBaselines: 0 };
    }
    const baselines = new BaselineModel(this.db, this.tables, this.storage);
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
