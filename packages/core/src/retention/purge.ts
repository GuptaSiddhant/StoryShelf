import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { Logger } from "pino";

import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { BuildModel } from "../models/build.ts";
import { LabelModel } from "../models/label.ts";
import { builds } from "../schema-tables.ts";
import type { Project } from "../schema.ts";
import { TERMINAL_BUILD_STATUSES } from "../types.ts";

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
      where: and(eq(builds.projectId, project.id), inArray(builds.status, [...TERMINAL_BUILD_STATUSES]), lt(builds.updatedAt, cutoff)),
    });

    const keep = options.keepLatestPerBranch ? await this.latestPerBranch(project.id) : new Set<string>();
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
    this.logger?.info({ projectId: project.id, removedBuilds, removedFiles }, "build retention purge complete");
    return { removedBuilds, removedFiles };
  }

  private async removeBuild(buildId: string): Promise<boolean> {
    await new BuildModel(this.db).remove(buildId);
    return true;
  }

  private async latestPerBranch(projectId: string): Promise<Set<string>> {
    const rows = await this.db.all<{ id: string; gitBranch: string }>(
      sql`SELECT id, gitBranch, createdAt FROM builds WHERE projectId = ${projectId} ORDER BY createdAt DESC`,
    );
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
}
