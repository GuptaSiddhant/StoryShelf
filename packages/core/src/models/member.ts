import { and, eq } from "drizzle-orm";

import type { DatabaseAdapter } from "../adapters/database.ts";
import { projectMembers, type ProjectMember } from "../schema.ts";
import type { ProjectRole, SiteRole } from "../types.ts";
import { ulid } from "../utils/ulid.ts";

/** Data operations for project membership and roles. */
export class MemberModel {
  /**
   * @param db - Database adapter.
   */
  constructor(private readonly db: DatabaseAdapter) {}

  /** List all members of a project. */
  async list(projectId: string): Promise<ProjectMember[]> {
    return await this.db.list(projectMembers, { where: eq(projectMembers.projectId, projectId) });
  }

  /** Fetch a project member by project and user id, or null if not found. */
  async get(projectId: string, userId: string): Promise<ProjectMember | null> {
    const rows = await this.db.list(projectMembers, {
      where: and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
      limit: 1,
    });
    return rows[0] ?? null;
  }

  /** Set a user's role in a project, creating the membership if needed. */
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

  /** Remove a user from a project if they are a member. */
  async remove(projectId: string, userId: string): Promise<void> {
    const existing = await this.get(projectId, userId);
    if (existing) {
      await this.db.remove(projectMembers, existing.id);
    }
  }

  /** Resolve a user's effective project role, honoring site-wide admins. */
  async effectiveRole(siteRole: SiteRole, projectId: string, userId: string): Promise<ProjectRole | null> {
    if (siteRole === "admin") {
      return "admin";
    }
    const member = await this.get(projectId, userId);
    return member?.role ?? null;
  }
}

export type { ProjectMember };
