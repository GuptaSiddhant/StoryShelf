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

    let removedBuilds = 0;
    let removedFiles = 0;
    for (const build of candidates) {
      if (keep.has(build.id) || (await new LabelModel(this.db).hasPersistent(project.id, build.id))) {
        continue;
      }
      removedFiles += await this.deleteBuildFiles(project.id, build.id);
      await new BuildModel(this.db).remove(build.id);
      removedBuilds += 1;
    }
    return { removedBuilds, removedFiles };
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
    for (const file of files) {
      await this.storage.delete(file);
    }
    return files.length;
  }
}
