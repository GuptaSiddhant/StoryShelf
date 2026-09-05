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

/** Build statuses eligible for retention purging. */
export const TERMINAL_BUILD_STATUSES: readonly BuildStatus[] = ["approved", "rejected", "failed"];

/** All site-wide user roles. */
export const SITE_ROLES = ["admin", "member"] as const;

/** Site-wide role of a user. */
export type SiteRole = (typeof SITE_ROLES)[number];

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

/** Label type keys reserved for internal use. */
export const RESERVED_LABEL_KEYS = ["build"] as const;

/** Label key marking a build as exempt from retention purging. */
export const PERSISTENT_LABEL_KEY = "persistent";
