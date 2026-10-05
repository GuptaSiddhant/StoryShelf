/** All lifecycle statuses a build can carry. */
export const BUILD_STATUSES = [
  "pending",
  "capturing",
  "comparing",
  "reviewing",
  "approved",
  "rejected",
  "failed",
] as const;

/** Lifecycle status of a build. */
export type BuildStatus = (typeof BUILD_STATUSES)[number];

/** All review statuses a snapshot can carry. */
export const SNAPSHOT_STATUSES = [
  "pending",
  "new",
  "unchanged",
  "changed",
  "approved",
  "rejected",
] as const;

/** Review status of a snapshot. */
export type SnapshotStatus = (typeof SNAPSHOT_STATUSES)[number];

/**
 * Build statuses considered terminal for retention purging.
 * Only builds that have finished review (`approved`, `rejected`, `failed`)
 * are eligible for TTL-based cleanup; `pending`/`reviewing` builds are kept.
 */
export const TERMINAL_BUILD_STATUSES: readonly BuildStatus[] = ["approved", "rejected", "failed"];

/** All site-wide user roles. */
export const SITE_ROLES = ["admin", "member", "viewer"] as const;

/** Site-wide role of a user. */
export type SiteRole = (typeof SITE_ROLES)[number];

/** Shared session cookie name used by auth (ADR 0008). */
export const SESSION_COOKIE = "storyshelf_session";

/** An authenticated user of the platform. */
export interface AuthUser {
  /** User ID. */
  id: string;
  /** User email. */
  email: string;
  /** Display name. */
  name: string;
  /** Optional avatar URL. */
  avatarUrl?: string;
  /** Site-wide role. */
  role: SiteRole;
  /**
   * Identity-provider group memberships (names or IDs, provider-dependent).
   * Populated when the provider exposes group claims; absent otherwise.
   * Drives group-to-role mapping at login.
   */
  groups?: string[];
  /**
   * Login method that minted this identity.
   * Matches an engine login method id; absent for single-method deployments.
   */
  providerId?: string;
}

/** All per-project membership roles. */
export const PROJECT_ROLES = ["admin", "approver", "developer", "viewer"] as const;

/** Per-project role of a member. */
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** Label type keys seeded for every new project. */
export const SEEDED_LABEL_KEYS = [
  "branch",
  "persistent",
  "pr",
  "mr",
  "jira",
  "linear",
  "figma",
  "custom",
] as const;

/** Label type keys reserved for internal bookkeeping (cannot be created by users). */
export const RESERVED_LABEL_KEYS = ["build"] as const;

/**
 * Label key that marks a build as exempt from retention purging.
 * Attach `persistent=true` to keep a build indefinitely, even after its TTL expires.
 */
export const PERSISTENT_LABEL_KEY = "persistent";
