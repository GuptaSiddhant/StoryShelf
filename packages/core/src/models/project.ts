import { eq } from "drizzle-orm";

import type { DatabaseAdapter } from "../adapters/database.ts";
import { projects, type Project } from "../schema.ts";
import { slugify, ulid } from "../utils/ulid.ts";

export interface ProjectCreateInput {
  name: string;
  gitRepository?: string;
  gitDefaultBranch?: string;
}

export class ProjectModel {
  constructor(private readonly db: DatabaseAdapter) {}

  async create(input: ProjectCreateInput): Promise<Project> {
    const now = new Date().toISOString();
    const slug = await this.uniqueSlug(input.name);
    return this.db.insert(projects, {
      id: ulid(),
      name: input.name,
      slug,
      gitRepository: input.gitRepository,
      gitDefaultBranch: input.gitDefaultBranch ?? "main",
      createdAt: now,
      updatedAt: now,
    });
  }

  async get(id: string): Promise<Project | null> {
    return this.db.get(projects, id);
  }

  async getBySlug(slug: string): Promise<Project | null> {
    const rows = await this.db.list(projects, { where: eq(projects.slug, slug), limit: 1 });
    return rows[0] ?? null;
  }

  async list(): Promise<Project[]> {
    return this.db.list(projects);
  }

  async update(id: string, patch: Partial<Pick<Project, "name" | "gitRepository" | "gitDefaultBranch" | "pixelThreshold" | "maxDiffRatio" | "publicBranchRegex">>): Promise<Project> {
    return this.db.update(projects, id, { ...patch, updatedAt: new Date().toISOString() });
  }

  async remove(id: string): Promise<void> {
    await this.db.remove(projects, id);
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || "project";
    let candidate = base;
    let suffix = 2;
    while ((await this.getBySlug(candidate)) !== null) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }
}

export type { Project };
