/** Project records and slug management. */
import { eq } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { projects } from "../schema-tables.ts";
import type { Project } from "../schema.ts";
import { slugify, ulid } from "../utils/ulid.ts";

/** Input for creating a project. */
export interface ProjectCreateInput {
  name: string;
  gitRepository?: string;
  gitDefaultBranch?: string;
  storybookMeta?: unknown;
}

/** Data operations for project records. */
export class ProjectModel {
  /**
   * @param db - Database adapter.
   */
  constructor(private readonly db: DatabaseAdapter) {}

  /**
   * Create a project with a unique slug.
   *
   * @param input - Project creation input.
   * @returns The created project.
   */
  async create(input: ProjectCreateInput): Promise<Project> {
    const now = new Date().toISOString();
    const slug = await this.uniqueSlug(input.name);
    return this.db.insert(projects, {
      id: ulid(),
      name: input.name,
      slug,
      gitRepository: input.gitRepository,
      gitDefaultBranch: input.gitDefaultBranch ?? "main",
      storybookMeta: input.storybookMeta ? JSON.stringify(input.storybookMeta) : null,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Fetch a project by id, or null if not found. */
  async get(id: string): Promise<Project | null> {
    return await this.db.get(projects, id);
  }

  /** Fetch a project by its slug, or null if not found. */
  async getBySlug(slug: string): Promise<Project | null> {
    const rows = await this.db.list(projects, { where: eq(projects.slug, slug), limit: 1 });
    return rows[0] ?? null;
  }

  /** List all projects. */
  async list(): Promise<Project[]> {
    return await this.db.list(projects);
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
    return await this.db.update(projects, id, {
      ...normalized,
      updatedAt: new Date().toISOString(),
    });
  }

  /** Delete a project by id. */
  async remove(id: string): Promise<void> {
    await this.db.remove(projects, id);
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || "project";
    const existing = await this.db.list(projects, { where: eq(projects.slug, base) });
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

export type { Project };
