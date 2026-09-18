/**
 * Database schema: row types (type-only).
 *
 * Core schema is now type-only — no runtime table definitions.
 * Table handles and the Drizzle schema object live in
 * `packages/db-sqlite` (and `packages/db-turso` reuses the same shape).
 * Row interfaces remain here for domain-layer typing.
 */

/** Baseline row as stored in the `baselines` table. */
export type { Baseline } from "./baseline.ts";
/** Build row as stored in the `builds` table. */
export type { Build } from "./build.ts";
/** Review comment row as stored in the `comments` table. */
export type { Comment } from "./comment.ts";
/** Build label and label type rows. */
export type { BuildLabel, LabelType } from "./label.ts";
/** Project membership row linking a user to a project role. */
export type { ProjectMember } from "./member.ts";
/** Identity-provider group to project-role mapping row. */
export type { ProjectGroupMapping } from "./project-group-mapping.ts";
/** Project row and its embedded Storybook metadata. */
export type { Project, StorybookMeta } from "./project.ts";
/** Snapshot row capturing a single story at one viewport. */
export type { Snapshot } from "./snapshot.ts";
/** Per-project git provider status-check configuration row. */
export type { ProjectStatusConfig } from "./status-config.ts";
/** CI token row (stores only the hash). */
export type { Token } from "./token.ts";
/** User row for authenticated identities. */
export type { User } from "./user.ts";
/** Webhook subscription row. */
export type { Webhook } from "./webhook.ts";

/** Placeholder schema type — Drizzle schema lives in the db adapters. */
export type Schema = Record<string, unknown>;
