import { and, eq, inArray, lt } from "drizzle-orm";

import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { BuildModel } from "../models/build.ts";
import { LabelModel } from "../models/label.ts";
import { builds, type Project } from "../schema.ts";
import { TERMINAL_BUILD_STATUSES } from "../types.ts";

export interface PurgeOptions {
  ttlDays: number;
  keepLatestPerBranch: boolean;
}

export interface PurgeResult {
  removedBuilds: number;
  removedFiles: number;
}

export class Retention {
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly storage: StorageAdapter,
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
    return {
      removedBuilds: results.filter((r) => r.removed).length,
      removedFiles: results.reduce((sum, r) => sum + r.files, 0),
    };
  }

  private async removeBuild(buildId: string): Promise<boolean> {
    await new BuildModel(this.db).remove(buildId);
    return true;
  }

  private async latestPerBranch(projectId: string): Promise<Set<string>> {
    const all = await this.db.list(builds, { where: eq(builds.projectId, projectId) });
    const latest = new Map<string, { id: string; createdAt: string }>();
    for (const build of all) {
      const current = latest.get(build.gitBranch);
      if (!current || build.createdAt > current.createdAt) {
        latest.set(build.gitBranch, { id: build.id, createdAt: build.createdAt });
      }
    }
    return new Set([...latest.values()].map((v) => v.id));
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
