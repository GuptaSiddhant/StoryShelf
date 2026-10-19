import type { ProjectRole } from "@storyshelf/core/types";

/** Roles permitted to view builds, snapshots, comments and project settings reads. */
export const VIEW_ROLES: readonly ProjectRole[] = ["viewer", "developer", "approver", "admin"];
/** Roles permitted to upload builds and write comments. */
export const DEVELOPER_ROLES: readonly ProjectRole[] = ["developer", "approver", "admin"];
/** Roles permitted to approve or reject snapshots and delete builds. */
export const APPROVER_ROLES: readonly ProjectRole[] = ["approver", "admin"];
/** Roles permitted to manage project configuration. */
export const ADMIN_ROLES: readonly ProjectRole[] = ["admin"];
