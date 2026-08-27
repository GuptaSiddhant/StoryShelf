import { and, desc, eq } from "drizzle-orm";

import type { DatabaseAdapter } from "../adapters/database.ts";
import { buildLabels, builds, labelTypes, type BuildLabel, type LabelType } from "../schema.ts";
import { PERSISTENT_LABEL_KEY, RESERVED_LABEL_KEYS, SEEDED_LABEL_KEYS } from "../types.ts";
import { ulid } from "../utils/ulid.ts";

const SEEDED_NAMES: Record<string, string> = {
  branch: "Branch",
  persistent: "Persistent",
  pr: "Pull request",
  mr: "Merge request",
  jira: "Jira issue",
  linear: "Linear issue",
  figma: "Figma file",
  custom: "Custom",
};

export class LabelModel {
  constructor(private readonly db: DatabaseAdapter) {}

  async seedFor(projectId: string): Promise<void> {
    const now = new Date().toISOString();
    for (const key of SEEDED_LABEL_KEYS) {
      const exists = await this.getType(projectId, key);
      if (exists) {
        continue;
      }
      await this.db.insert(labelTypes, {
        id: ulid(),
        projectId,
        key,
        name: SEEDED_NAMES[key] ?? key,
        createdAt: now,
      });
    }
  }

  async listTypes(projectId: string): Promise<LabelType[]> {
    return this.db.list(labelTypes, { where: eq(labelTypes.projectId, projectId) });
  }

  async getType(projectId: string, key: string): Promise<LabelType | null> {
    const rows = await this.db.list(labelTypes, {
      where: and(eq(labelTypes.projectId, projectId), eq(labelTypes.key, key)),
      limit: 1,
    });
    return rows[0] ?? null;
  }

  async createType(projectId: string, input: { key: string; name: string; linkTemplate?: string; color?: string }): Promise<LabelType> {
    return this.db.insert(labelTypes, {
      id: ulid(),
      projectId,
      key: input.key,
      name: input.name,
      linkTemplate: input.linkTemplate,
      color: input.color,
      createdAt: new Date().toISOString(),
    });
  }

  async removeType(projectId: string, key: string): Promise<void> {
    if (key === PERSISTENT_LABEL_KEY || RESERVED_LABEL_KEYS.includes(key as never)) {
      throw new Error(`Label type '${key}' cannot be removed.`);
    }
    const existing = await this.getType(projectId, key);
    if (existing) {
      await this.db.remove(labelTypes, existing.id);
    }
  }

  async attach(projectId: string, buildId: string, typeKey: string, value: string): Promise<BuildLabel> {
    return this.db.insert(buildLabels, {
      id: ulid(),
      projectId,
      buildId,
      typeKey,
      value,
      createdAt: new Date().toISOString(),
    });
  }

  async listForBuild(buildId: string): Promise<BuildLabel[]> {
    return this.db.list(buildLabels, { where: eq(buildLabels.buildId, buildId) });
  }

  async latestBuildId(projectId: string, typeKey: string, value: string): Promise<string | null> {
    const labels = await this.db.list(buildLabels, {
      where: and(eq(buildLabels.projectId, projectId), eq(buildLabels.typeKey, typeKey), eq(buildLabels.value, value)),
    });
    if (labels.length === 0) {
      return null;
    }
    const ids = labels.map((l) => l.buildId);
    const rows = await this.db.list(builds, { orderBy: desc(builds.createdAt) });
    return rows.find((b) => ids.includes(b.id))?.id ?? null;
  }

  async hasPersistent(projectId: string, buildId: string): Promise<boolean> {
    const labels = await this.db.list(buildLabels, {
      where: and(eq(buildLabels.projectId, projectId), eq(buildLabels.buildId, buildId), eq(buildLabels.typeKey, PERSISTENT_LABEL_KEY)),
    });
    return labels.length > 0;
  }
}

export type { BuildLabel, LabelType };
