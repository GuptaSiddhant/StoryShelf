import type { AuthUser } from "@storyshelf/core/adapter/auth";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import {
  MemberModel,
  ProjectGroupMappingModel,
  ProjectModel,
  UserModel,
} from "@storyshelf/core/models";
import type { ProjectRole } from "@storyshelf/core/types";
import type { Table } from "drizzle-orm";

/** Tables required to sync a login. */
export interface LoginSyncTables {
  users: Table;
  projects: Table;
  projectMembers: Table;
  projectGroupMappings: Table;
}

const ROLE_RANK: Record<ProjectRole, number> = {
  viewer: 0,
  developer: 1,
  approver: 2,
  admin: 3,
};

/**
 * Persist the authenticated identity and reconcile OIDC group memberships.
 *
 * Always upserts the user row. Group mappings apply per project: the highest
 * matched role wins (recorded as `oidc:<group>`); memberships from groups the
 * user no longer matches are removed — manual grants are never touched.
 */
export async function syncLoginMemberships(
  db: DatabaseAdapter,
  _tables: LoginSyncTables,
  user: AuthUser,
): Promise<void> {
  await new UserModel(db).upsert({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl ?? null,
    role: user.role,
  });
  const groups = user.groups ?? [];
  const projects = await new ProjectModel(db).list();
  const members = new MemberModel(db);
  const mappings = new ProjectGroupMappingModel(db);
  await Promise.all(
    projects.map(
      // oxlint-disable-next-line typescript/promise-function-async -- returns the inner promise directly
      (project) => syncProjectMembership(members, mappings, project.id, user.id, groups),
    ),
  );
}

/** Highest-ranked matched mapping, or null when nothing matches. */
function topMatch(
  rows: { groupName: string; role: ProjectRole }[],
  groups: string[],
): { groupName: string; role: ProjectRole } | null {
  let top: { groupName: string; role: ProjectRole } | null = null;
  for (const row of rows) {
    if (!groups.includes(row.groupName)) {
      continue;
    }
    if (!top || ROLE_RANK[row.role] > ROLE_RANK[top.role]) {
      top = { groupName: row.groupName, role: row.role };
    }
  }
  return top;
}

/** Remove a synced grant the user no longer matches; manual grants survive. */
async function revokeIfStale(
  members: MemberModel,
  projectId: string,
  userId: string,
): Promise<void> {
  const existing = await members.get(projectId, userId);
  if (existing && existing.source !== "manual") {
    await members.remove(projectId, userId);
  }
}

async function syncProjectMembership(
  members: MemberModel,
  mappings: ProjectGroupMappingModel,
  projectId: string,
  userId: string,
  groups: string[],
): Promise<void> {
  const rows = await mappings.list(projectId);
  if (rows.length === 0) {
    return;
  }
  const top = topMatch(rows, groups);
  if (!top) {
    await revokeIfStale(members, projectId, userId);
    return;
  }
  const existing = await members.get(projectId, userId);
  if (!existing || existing.role !== top.role || existing.source !== `oidc:${top.groupName}`) {
    await members.set(projectId, userId, top.role, `oidc:${top.groupName}`);
  }
}
