/** Build labels and project label types. */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { BuildLabel, LabelType } from "../schema/label.ts";
import { PERSISTENT_LABEL_KEY, RESERVED_LABEL_KEYS, SEEDED_LABEL_KEYS } from "../types.ts";
import { ulid } from "../utils/ulid.ts";
import { col } from "./columns.ts";

/** Tables required by {@link LabelModel}. */
export interface LabelTables {
  builds: Table;
  buildLabels: Table;
  labelTypes: Table;
}

/** Data operations for label types and build labels. */
export class LabelModel {
  private readonly tables: LabelTables;
  private readonly db: DatabaseAdapter;

  /**
   * @param db - Database adapter.
   * @param tables - Table handles.
   */
  constructor(db: DatabaseAdapter, tables?: LabelTables) {
    this.db = db;
    this.tables = tables ?? {
      builds: db.tables.builds,
      buildLabels: db.tables.buildLabels,
      labelTypes: db.tables.labelTypes,
    };
  }

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
          linkTemplate: SEEDED_LINK_TEMPLATES[key],
          createdAt: now,
        });
      }),
    );
  }

  /** List all label types for a project. */
  async listTypes(projectId: string): Promise<LabelType[]> {
    return (await this.db.list(this.tables.labelTypes, {
      where: eq(col(this.tables.labelTypes, "projectId"), projectId),
    })) as unknown as LabelType[];
  }

  /** Fetch a label type by key, or null if not found. */
  async getType(projectId: string, key: string): Promise<LabelType | null> {
    const rows = (await this.db.list(this.tables.labelTypes, {
      where: and(
        eq(col(this.tables.labelTypes, "projectId"), projectId),
        eq(col(this.tables.labelTypes, "key"), key),
      ),
      limit: 1,
    })) as unknown as LabelType[];
    return rows[0] ?? null;
  }

  /** Create a custom label type for a project. */
  async createType(
    projectId: string,
    input: { key: string; name: string; linkTemplate?: string; color?: string },
  ): Promise<LabelType> {
    return (await this.db.insert(this.tables.labelTypes, {
      id: ulid(),
      projectId,
      key: input.key,
      name: input.name,
      linkTemplate: input.linkTemplate,
      color: input.color,
      createdAt: new Date().toISOString(),
    })) as unknown as LabelType;
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
    return (await this.db.update(this.tables.labelTypes, existing.id, {
      name: input.name ?? existing.name,
      linkTemplate: input.linkTemplate === undefined ? existing.linkTemplate : input.linkTemplate,
      color: input.color === undefined ? existing.color : input.color,
    })) as unknown as LabelType;
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
    return (await this.db.insert(this.tables.buildLabels, {
      id: ulid(),
      projectId,
      buildId,
      typeKey,
      value,
      createdAt: new Date().toISOString(),
    })) as unknown as BuildLabel;
  }

  /** List all labels attached to a build. */
  async listForBuild(buildId: string): Promise<BuildLabel[]> {
    return (await this.db.list(this.tables.buildLabels, {
      where: eq(col(this.tables.buildLabels, "buildId"), buildId),
    })) as unknown as BuildLabel[];
  }

  /** Return the id of the latest build carrying a given label value, if any. */
  async latestBuildId(projectId: string, typeKey: string, value: string): Promise<string | null> {
    const labels = (await this.db.list(this.tables.buildLabels, {
      where: and(
        eq(col(this.tables.buildLabels, "projectId"), projectId),
        eq(col(this.tables.buildLabels, "typeKey"), typeKey),
        eq(col(this.tables.buildLabels, "value"), value),
      ),
    })) as unknown as BuildLabel[];
    if (labels.length === 0) {
      return null;
    }
    const newest = (await this.db.list(this.tables.builds, {
      where: inArray(
        col(this.tables.builds, "id"),
        labels.map((label) => label.buildId),
      ),
      orderBy: desc(col(this.tables.builds, "createdAt")),
      limit: 1,
    })) as unknown as { id: string }[];
    return newest[0]?.id ?? null;
  }

  /** Whether a build is marked as persistent. */
  async hasPersistent(projectId: string, buildId: string): Promise<boolean> {
    return (await this.persistentBuildIds(projectId)).has(buildId);
  }

  /** Ids of the project's builds marked persistent (exempt from retention). */
  async persistentBuildIds(projectId: string): Promise<Set<string>> {
    const labels = (await this.db.list(this.tables.buildLabels, {
      where: and(
        eq(col(this.tables.buildLabels, "projectId"), projectId),
        eq(col(this.tables.buildLabels, "typeKey"), PERSISTENT_LABEL_KEY),
      ),
    })) as unknown as BuildLabel[];
    return new Set(labels.map((label) => label.buildId));
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

/** Default link templates; jira, linear and figma are org-specific, so they stay unset. */
const SEEDED_LINK_TEMPLATES: Record<string, string | undefined> = {
  pr: "https://github.com/{repo}/pull/{value}",
  mr: "https://gitlab.com/{repo}/-/merge_requests/{value}",
};
