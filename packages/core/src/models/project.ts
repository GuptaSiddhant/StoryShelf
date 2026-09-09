/** Project records and slug management. */
import { eq, getTableColumns } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../db/database.ts";
import type { Project } from "../schema/project.ts";
import { slugify, ulid } from "../utils/ulid.ts";

/** Tables required by {@link ProjectModel}. */
export interface ProjectTables {
  projects: Table;
}

/** Data operations for project records. */
export class ProjectModel {
  /**
   * @param db - Database adapter.
   * @param tables - Table handles (injected by the database adapter).
   */
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly tables: ProjectTables,
  ) {}

  /**
   * Create a project with a unique slug.
   *
   * @param input - Project creation input.
   * @returns The created project.
   */
  async create(input: ProjectCreateInput): Promise<Project> {
    const now = new Date().toISOString();
    const slug = await this.uniqueSlug(input.name);
    return (await this.db.insert(this.tables.projects, {
      id: ulid(),
      name: input.name,
      slug,
      gitRepository: input.gitRepository,
      gitDefaultBranch: input.gitDefaultBranch ?? "main",
      storybookMeta: input.storybookMeta ? JSON.stringify(input.storybookMeta) : null,
      createdAt: now,
      updatedAt: now,
    })) as unknown as Project;
  }

  /** Fetch a project by id, or null if not found. */
  async get(id: string): Promise<Project | null> {
    return (await this.db.get(this.tables.projects, id)) as unknown as Project | null;
  }

  /** Fetch a project by its slug, or null if not found. */
  async getBySlug(slug: string): Promise<Project | null> {
    const rows = (await this.db.list(this.tables.projects, {
      where: eq(getTableColumns(this.tables.projects)["slug"] as unknown as SQLWrapper, slug),
      limit: 1,
    })) as unknown as Project[];
    return rows[0] ?? null;
  }

  /** List all projects. */
  async list(): Promise<Project[]> {
    return (await this.db.list(this.tables.projects)) as unknown as Project[];
  }

  /** Update mutable fields of a project. */
  async update(
    id: string,
    patch: Partial<Omit<Project, "storybookMeta">> & {
      storybookMeta?: unknown;
    },
  ): Promise<Project> {
    const normalized: Partial<Project> & Record<string, unknown> = {
      ...patch,
    } as unknown as Partial<Project> & Record<string, unknown>;
    if (
      patch.storybookMeta !== undefined &&
      patch.storybookMeta !== null &&
      typeof patch.storybookMeta !== "string"
    ) {
      normalized.storybookMeta = JSON.stringify(patch.storybookMeta);
    }
    return (await this.db.update(this.tables.projects, id, {
      ...normalized,
      updatedAt: new Date().toISOString(),
    })) as unknown as Project;
  }

  /** Delete a project by id. */
  async remove(id: string): Promise<void> {
    await this.db.remove(this.tables.projects, id);
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || "project";
    const existing = (await this.db.list(this.tables.projects, {
      where: eq(getTableColumns(this.tables.projects)["slug"] as unknown as SQLWrapper, base),
    })) as unknown as Project[];
    if (existing.length === 0) {
      return base;
    }
    const taken = new Set(existing.map((p) => p.slug));
    let suffix = 2;
    while (taken.has(`${base}-${suffix}`)) {
      suffix += 1;
    }
    return `${base}-${suffix}`;
  }
}

/** Input for creating a project. */
export interface ProjectCreateInput {
  name: string;
  gitRepository?: string;
  gitDefaultBranch?: string;
  storybookMeta?: unknown;
}
