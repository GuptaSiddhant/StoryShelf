import { and, eq } from "drizzle-orm";

import type { DatabaseAdapter } from "../adapters/database.ts";
import { projectMembers, type ProjectMember } from "../schema.ts";
import type { ProjectRole, SiteRole } from "../types.ts";
import { ulid } from "../utils/ulid.ts";

export class MemberModel {
  constructor(private readonly db: DatabaseAdapter) {}

  async list(projectId: string): Promise<ProjectMember[]> {
    return await this.db.list(projectMembers, { where: eq(projectMembers.projectId, projectId) });
  }

  async get(projectId: string, userId: string): Promise<ProjectMember | null> {
    const rows = await this.db.list(projectMembers, {
      where: and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
      limit: 1,
    });
    return rows[0] ?? null;
  }

  async set(projectId: string, userId: string, role: ProjectRole): Promise<ProjectMember> {
    const existing = await this.get(projectId, userId);
    if (existing) {
      return this.db.update(projectMembers, existing.id, { role });
    }
    return this.db.insert(projectMembers, {
      id: ulid(),
      projectId,
      userId,
      role,
      createdAt: new Date().toISOString(),
    });
  }

  async remove(projectId: string, userId: string): Promise<void> {
    const existing = await this.get(projectId, userId);
    if (existing) {
      await this.db.remove(projectMembers, existing.id);
    }
  }

  async effectiveRole(siteRole: SiteRole, projectId: string, userId: string): Promise<ProjectRole | null> {
    if (siteRole === "admin") {
      return "admin";
    }
    const member = await this.get(projectId, userId);
    return member?.role ?? null;
  }
}

export type { ProjectMember };
