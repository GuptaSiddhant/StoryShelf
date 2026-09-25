/** Project membership and role resolution. */
import { and, eq, getTableColumns } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../db/database.ts";
import type { ProjectMember } from "../schema/member.ts";
import type { ProjectRole, SiteRole } from "../types.ts";
import { ulid } from "../utils/ulid.ts";

/** Tables required by {@link MemberModel}. */
export interface MemberTables {
  projectMembers: Table;
}

/** Data operations for project membership and roles. */
export class MemberModel {
  private readonly tables: MemberTables;
  /**
   * @param db - Database adapter.
   * @param tables - Table handles.
   */
  constructor(
    private readonly db: DatabaseAdapter,
    tables?: MemberTables,
  ) {
    this.tables = tables ?? { projectMembers: db.tables.projectMembers };
  }

  /** List all members of a project. */
  async list(projectId: string): Promise<ProjectMember[]> {
    return (await this.db.list(this.tables.projectMembers, {
      where: eq(
        getTableColumns(this.tables.projectMembers)["projectId"] as unknown as SQLWrapper,
        projectId,
      ),
    })) as unknown as ProjectMember[];
  }

  /** Fetch a project member by project and user id, or null if not found. */
  async get(projectId: string, userId: string): Promise<ProjectMember | null> {
    const rows = (await this.db.list(this.tables.projectMembers, {
      where: and(
        eq(
          getTableColumns(this.tables.projectMembers)["projectId"] as unknown as SQLWrapper,
          projectId,
        ),
        eq(getTableColumns(this.tables.projectMembers)["userId"] as unknown as SQLWrapper, userId),
      ),
      limit: 1,
    })) as unknown as ProjectMember[];
    return rows[0] ?? null;
  }

  /** Set a user's role in a project, creating the membership if needed. */
  async set(
    projectId: string,
    userId: string,
    role: ProjectRole,
    source = "manual",
  ): Promise<ProjectMember> {
    const existing = await this.get(projectId, userId);
    if (existing) {
      return (await this.db.update(this.tables.projectMembers, existing.id, {
        role,
        source,
      })) as unknown as ProjectMember;
    }
    return (await this.db.insert(this.tables.projectMembers, {
      id: ulid(),
      projectId,
      userId,
      role,
      source,
      createdAt: new Date().toISOString(),
    })) as unknown as ProjectMember;
  }

  /** Remove a user from a project if they are a member. */
  async remove(projectId: string, userId: string): Promise<void> {
    const existing = await this.get(projectId, userId);
    if (existing) {
      await this.db.remove(this.tables.projectMembers, existing.id);
    }
  }

  /** Resolve a user's effective project role, honoring site-wide admins. */
  async effectiveRole(
    siteRole: SiteRole,
    projectId: string,
    userId: string,
  ): Promise<ProjectRole | null> {
    if (siteRole === "admin") {
      return "admin";
    }
    const member = await this.get(projectId, userId);
    if (member) {
      return member.role;
    }
    // Site viewers read every project; explicit membership always wins.
    if (siteRole === "viewer") {
      return "viewer";
    }
    return null;
  }
}
