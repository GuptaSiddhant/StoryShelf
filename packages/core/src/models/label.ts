/** Build labels and project label types. */
import { and, desc, eq } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../db/database.ts";
import type { Build } from "../schema/build.ts";
import type { BuildLabel, LabelType } from "../schema/label.ts";
import { PERSISTENT_LABEL_KEY, RESERVED_LABEL_KEYS, SEEDED_LABEL_KEYS } from "../types.ts";
import { ulid } from "../utils/ulid.ts";

/** Tables required by {@link LabelModel}. */
export interface LabelTables {
  builds: { createdAt: SQLWrapper } & Table & { $inferSelect: Build; $inferInsert: Build };
  buildLabels: {
    projectId: SQLWrapper;
    typeKey: SQLWrapper;
    value: SQLWrapper;
    buildId: SQLWrapper;
  } & Table & { $inferSelect: BuildLabel; $inferInsert: BuildLabel };
  labelTypes: { projectId: SQLWrapper; key: SQLWrapper } & Table & {
      $inferSelect: LabelType;
      $inferInsert: LabelType;
    };
}

/** Data operations for label types and build labels. */
export class LabelModel {
  /**
   * @param db - Database adapter.
   * @param tables - Table handles.
   */
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly tables: LabelTables,
  ) {}

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
        await this.db.insert(this.tables.labelTypes, {
          id: ulid(),
          projectId,
          key,
          name: SEEDED_NAMES[key] ?? key,
          createdAt: now,
        } as never);
      }),
    );
  }

  /** List all label types for a project. */
  async listTypes(projectId: string): Promise<LabelType[]> {
    return await this.db.list(this.tables.labelTypes, {
      where: eq(this.tables.labelTypes.projectId, projectId),
    });
  }

  /** Fetch a label type by key, or null if not found. */
  async getType(projectId: string, key: string): Promise<LabelType | null> {
    const rows = await this.db.list(this.tables.labelTypes, {
      where: and(
        eq(this.tables.labelTypes.projectId, projectId),
        eq(this.tables.labelTypes.key, key),
      ),
      limit: 1,
    });
    return rows[0] ?? null;
  }

  /** Create a custom label type for a project. */
  async createType(
    projectId: string,
    input: { key: string; name: string; linkTemplate?: string; color?: string },
  ): Promise<LabelType> {
    return await this.db.insert(this.tables.labelTypes, {
      id: ulid(),
      projectId,
      key: input.key,
      name: input.name,
      linkTemplate: input.linkTemplate,
      color: input.color,
      createdAt: new Date().toISOString(),
    } as never);
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
    return await this.db.update(this.tables.labelTypes, existing.id, {
      name: input.name ?? existing.name,
      linkTemplate: input.linkTemplate === undefined ? existing.linkTemplate : input.linkTemplate,
      color: input.color === undefined ? existing.color : input.color,
    } as never);
  }

  /** Remove a custom label type, rejecting reserved or persistent types. */
  async removeType(projectId: string, key: string): Promise<void> {
    if (key === PERSISTENT_LABEL_KEY || RESERVED_LABEL_KEYS.includes(key as never)) {
      throw new Error(`Label type '${key}' cannot be removed.`);
    }
    const existing = await this.getType(projectId, key);
    if (existing) {
      await this.db.remove(this.tables.labelTypes, existing.id);
    }
  }

  /** Attach a label value to a build. */
  async attach(
    projectId: string,
    buildId: string,
    typeKey: string,
    value: string,
  ): Promise<BuildLabel> {
    return await this.db.insert(this.tables.buildLabels, {
      id: ulid(),
      projectId,
      buildId,
      typeKey,
      value,
      createdAt: new Date().toISOString(),
    } as never);
  }

  /** List all labels attached to a build. */
  async listForBuild(buildId: string): Promise<BuildLabel[]> {
    return await this.db.list(this.tables.buildLabels, {
      where: eq(this.tables.buildLabels.buildId, buildId),
    });
  }

  /** Return the id of the latest build carrying a given label value, if any. */
  async latestBuildId(projectId: string, typeKey: string, value: string): Promise<string | null> {
    const labels = await this.db.list(this.tables.buildLabels, {
      where: and(
        eq(this.tables.buildLabels.projectId, projectId),
        eq(this.tables.buildLabels.typeKey, typeKey),
        eq(this.tables.buildLabels.value, value),
      ),
    });
    if (labels.length === 0) {
      return null;
    }
    const idSet = new Set(labels.map((l) => l.buildId));
    const rows = await this.db.list(this.tables.builds, {
      orderBy: desc(this.tables.builds.createdAt),
    });
    return rows.find((b) => idSet.has(b.id))?.id ?? null;
  }

  /** Return whether a build is marked as persistent. */
  async hasPersistent(projectId: string, buildId: string): Promise<boolean> {
    const labels = await this.db.list(this.tables.buildLabels, {
      where: and(
        eq(this.tables.buildLabels.projectId, projectId),
        eq(this.tables.buildLabels.buildId, buildId),
        eq(this.tables.buildLabels.typeKey, PERSISTENT_LABEL_KEY),
      ),
    });
    return labels.length > 0;
  }
}

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
