/** Build labels and project label types. */
import { and, desc, eq } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { builds } from "../schema/build.ts";
import { buildLabels, labelTypes } from "../schema/label.ts";
import type { BuildLabel, LabelType } from "../schema/label.ts";
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

/** Data operations for label types and build labels. */
export class LabelModel {
  /**
   * @param db - Database adapter.
   */
  constructor(private readonly db: DatabaseAdapter) {}

  /**
   * Seed the default label types for a project if missing.
   *
   * @param projectId - Project ID.
   */
  async seedFor(projectId: string): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.listTypes(projectId);
    const existingKeys = new Set(existing.map((t) => t.key));
    const missing = SEEDED_LABEL_KEYS.filter((key) => !existingKeys.has(key));
    await Promise.all(
      missing.map(async (key) => {
        await this.db.insert(labelTypes, {
          id: ulid(),
          projectId,
          key,
          name: SEEDED_NAMES[key] ?? key,
          createdAt: now,
        });
      }),
    );
  }

  /** List all label types for a project. */
  async listTypes(projectId: string): Promise<LabelType[]> {
    return await this.db.list(labelTypes, { where: eq(labelTypes.projectId, projectId) });
  }

  /** Fetch a label type by key, or null if not found. */
  async getType(projectId: string, key: string): Promise<LabelType | null> {
    const rows = await this.db.list(labelTypes, {
      where: and(eq(labelTypes.projectId, projectId), eq(labelTypes.key, key)),
      limit: 1,
    });
    return rows[0] ?? null;
  }

  /** Create a custom label type for a project. */
  async createType(
    projectId: string,
    input: { key: string; name: string; linkTemplate?: string; color?: string },
  ): Promise<LabelType> {
    return await this.db.insert(labelTypes, {
      id: ulid(),
      projectId,
      key: input.key,
      name: input.name,
      linkTemplate: input.linkTemplate,
      color: input.color,
      createdAt: new Date().toISOString(),
    });
  }

  /** Update a custom label type's name, template or color. */
  async updateType(
    projectId: string,
    key: string,
    input: { name?: string; linkTemplate?: string | null; color?: string | null },
  ): Promise<LabelType | null> {
    if (key === PERSISTENT_LABEL_KEY || RESERVED_LABEL_KEYS.includes(key as never)) {
      throw new Error(`Label type '${key}' cannot be updated.`);
    }
    const existing = await this.getType(projectId, key);
    if (!existing) {
      return null;
    }
    return await this.db.update(labelTypes, existing.id, {
      name: input.name ?? existing.name,
      linkTemplate: input.linkTemplate === undefined ? existing.linkTemplate : input.linkTemplate,
      color: input.color === undefined ? existing.color : input.color,
    });
  }

  /** Remove a custom label type, rejecting reserved or persistent types. */
  async removeType(projectId: string, key: string): Promise<void> {
    if (key === PERSISTENT_LABEL_KEY || RESERVED_LABEL_KEYS.includes(key as never)) {
      throw new Error(`Label type '${key}' cannot be removed.`);
    }
    const existing = await this.getType(projectId, key);
    if (existing) {
      await this.db.remove(labelTypes, existing.id);
    }
  }

  /** Attach a label value to a build. */
  async attach(
    projectId: string,
    buildId: string,
    typeKey: string,
    value: string,
  ): Promise<BuildLabel> {
    return await this.db.insert(buildLabels, {
      id: ulid(),
      projectId,
      buildId,
      typeKey,
      value,
      createdAt: new Date().toISOString(),
    });
  }

  /** List all labels attached to a build. */
  async listForBuild(buildId: string): Promise<BuildLabel[]> {
    return await this.db.list(buildLabels, { where: eq(buildLabels.buildId, buildId) });
  }

  /** Return the id of the latest build carrying a given label value, if any. */
  async latestBuildId(projectId: string, typeKey: string, value: string): Promise<string | null> {
    const labels = await this.db.list(buildLabels, {
      where: and(
        eq(buildLabels.projectId, projectId),
        eq(buildLabels.typeKey, typeKey),
        eq(buildLabels.value, value),
      ),
    });
    if (labels.length === 0) {
      return null;
    }
    const idSet = new Set(labels.map((l) => l.buildId));
    const rows = await this.db.list(builds, { orderBy: desc(builds.createdAt) });
    return rows.find((b) => idSet.has(b.id))?.id ?? null;
  }

  /** Return whether a build is marked as persistent. */
  async hasPersistent(projectId: string, buildId: string): Promise<boolean> {
    const labels = await this.db.list(buildLabels, {
      where: and(
        eq(buildLabels.projectId, projectId),
        eq(buildLabels.buildId, buildId),
        eq(buildLabels.typeKey, PERSISTENT_LABEL_KEY),
      ),
    });
    return labels.length > 0;
  }
}
