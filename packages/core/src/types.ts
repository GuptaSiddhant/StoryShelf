export const BUILD_STATUSES = [
  "pending",
  "capturing",
  "comparing",
  "reviewing",
  "approved",
  "rejected",
  "failed",
] as const;

export type BuildStatus = (typeof BUILD_STATUSES)[number];

export const SNAPSHOT_STATUSES = ["pending", "new", "unchanged", "changed", "approved", "rejected"] as const;

export type SnapshotStatus = (typeof SNAPSHOT_STATUSES)[number];

export const TERMINAL_BUILD_STATUSES: readonly BuildStatus[] = ["approved", "rejected", "failed"];

export const SITE_ROLES = ["admin", "member"] as const;

export type SiteRole = (typeof SITE_ROLES)[number];

export const PROJECT_ROLES = ["admin", "approver", "developer", "viewer"] as const;

export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const SEEDED_LABEL_KEYS = ["branch", "persistent", "pr", "mr", "jira", "linear", "figma", "custom"] as const;

export const RESERVED_LABEL_KEYS = ["build"] as const;

export const PERSISTENT_LABEL_KEY = "persistent";
