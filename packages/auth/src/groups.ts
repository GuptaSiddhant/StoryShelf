/**
 * IdP group sync for SSO providers (site role + project memberships).
 *
 * The SSO plugin calls the hook with raw provider `userInfo` on every
 * sign-in (`provisionUserOnEveryLogin`); this module turns group claims into
 * shelf state. Semantics mirror the app-side login sync: exact group names
 * (no wildcards), highest-ranked project role wins recorded as `sso:<group>`,
 * stale non-manual grants revoked, manual grants never touched. Social and
 * generic-OAuth logins have no per-login hook and never sync groups.
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import {
  MemberModel,
  ProjectGroupMappingModel,
  ProjectModel,
  UserModel,
} from "@storyshelf/core/models";
import type { ProjectRole, SiteRole } from "@storyshelf/core/types";
import type { ShelfSSOProvider } from "./engine.ts";

/** Default claim name when recipes leave `groups.claim` unset. */
export const DEFAULT_GROUP_CLAIM = "groups";

/** Rank for top-match resolution (highest role wins). */
const ROLE_RANK: Record<ProjectRole, number> = { viewer: 0, developer: 1, approver: 2, admin: 3 };

/** Collect group names from one claim value. */
function claimGroups(value: unknown, into: string[]): void {
  if (typeof value === "string" && value) {
    into.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string" && entry) {
        into.push(entry);
      }
    }
  }
}

/**
 * Read group names from provider userInfo. Arrays pass through; a lone
 * string counts as exactly one group (never whitespace-split — real names
 * contain spaces). Non-string entries are ignored. First claim hit wins
 * across names; results de-duplicated.
 */
export function extractGroups(
  userInfo: Record<string, unknown>,
  claim?: string | string[],
): string[] {
  const names =
    claim === undefined ? [DEFAULT_GROUP_CLAIM] : Array.isArray(claim) ? claim : [claim];
  for (const name of names) {
    const found: string[] = [];
    claimGroups(userInfo[name], found);
    if (found.length > 0) {
      return [...new Set(found)];
    }
  }
  return [];
}

/**
 * Site role from admin-group intersection (full reconcile). Without
 * configured admins the current role passes through untouched.
 */
export function resolveSiteRole(
  current: SiteRole,
  groups: string[],
  admins: string[] = [],
): SiteRole {
  if (admins.length === 0) {
    return current;
  }
  return groups.some((group) => admins.includes(group)) ? "admin" : "member";
}

/** Input mapped from the SSO plugin's provisionUser payload. */
export interface GroupProvisionData {
  user: { id: string; email: string; name: string };
  userInfo: Record<string, unknown>;
  provider: { providerId: string };
}

/** Normalized input for the sync (plugin payload flattened). */
export interface SsoGroupSyncInput {
  userId: string;
  email: string;
  name: string;
  userInfo: Record<string, unknown>;
  providerId: string;
}

/**
 * Build the plugin `provisionUser` hook bound to shelf providers.
 * Unknown provider ids are no-ops (defensive; the plugin resolves first).
 */
export function provisionHook(
  db: DatabaseAdapter,
  providers: ShelfSSOProvider[],
): (data: GroupProvisionData) => Promise<void> {
  return async (data) => {
    await syncSsoGroups(db, providers, {
      userId: data.user.id,
      email: data.user.email,
      name: data.user.name,
      userInfo: data.userInfo,
      providerId: data.provider.providerId,
    });
  };
}

/** Highest-ranked mapping matched by the groups, or null. */
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

/** Reconcile one project's memberships against the groups. */
async function syncProjectGroups(
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
  const existing = await members.get(projectId, userId);
  // Manual grants win over IdP mappings, always.
  if (existing?.source === "manual") {
    return;
  }
  await applyProjectTop(members, projectId, userId, topMatch(rows, groups));
}

/** Apply the top match (or revoke stale) for one project. */
async function applyProjectTop(
  members: MemberModel,
  projectId: string,
  userId: string,
  top: { groupName: string; role: ProjectRole } | null,
): Promise<void> {
  if (!top) {
    await revokeStale(members, projectId, userId);
    return;
  }
  const current = await members.get(projectId, userId);
  if (!current || current.role !== top.role || current.source !== `sso:${top.groupName}`) {
    await members.set(projectId, userId, top.role, `sso:${top.groupName}`);
  }
}

/** Remove a stale synced grant (manual grants already excluded by the caller). */
async function revokeStale(members: MemberModel, projectId: string, userId: string): Promise<void> {
  const existing = await members.get(projectId, userId);
  if (existing) {
    await members.remove(projectId, userId);
  }
}

/** Apply the reconciled site role (upsert first-timers, update on change). */
async function syncSiteRole(
  db: DatabaseAdapter,
  input: SsoGroupSyncInput,
  role: SiteRole,
): Promise<void> {
  const users = new UserModel(db);
  const stored = await users.get(input.userId);
  if (!stored) {
    await users.upsert({
      id: input.userId,
      email: input.email,
      name: input.name,
      avatarUrl: null,
      role,
    });
  } else if (stored.role !== role) {
    await db.update(db.tables.users, stored.id, { role });
  }
}

/** Reconcile project memberships across every project. */
async function syncProjectRoles(
  db: DatabaseAdapter,
  userId: string,
  groups: string[],
): Promise<void> {
  const members = new MemberModel(db);
  const mappings = new ProjectGroupMappingModel(db);
  const projects = await new ProjectModel(db).list();
  await Promise.all(
    projects.map(async (project) => {
      await syncProjectGroups(members, mappings, project.id, userId, groups);
    }),
  );
}

/**
 * Sync IdP groups into shelf state: site role (full reconcile) plus project
 * memberships. No-op for providers without `groups` config. Creates the
 * shelf row on first SSO login when the mirror hook has not run yet.
 */
export async function syncSsoGroups(
  db: DatabaseAdapter,
  providers: ShelfSSOProvider[],
  input: SsoGroupSyncInput,
): Promise<void> {
  const provider = providers.find((entry) => entry.id === input.providerId);
  const sync = provider?.groups;
  if (!sync) {
    return;
  }
  const groups = extractGroups(input.userInfo, sync.claim);
  const stored = await new UserModel(db).get(input.userId);
  const role = resolveSiteRole(stored?.role ?? "member", groups, sync.admins);
  await syncSiteRole(db, input, role);
  await syncProjectRoles(db, input.userId, groups);
}
