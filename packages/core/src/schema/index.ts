/**
 * Database schema: table handles, row types, and the schema object passed
 * to the database client.
 */
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";

import { baselines as baselinesTable } from "./baseline.ts";
import { buildLabels as buildLabelsTable, labelTypes as labelTypesTable } from "./label.ts";
import { builds as buildsTable } from "./build.ts";
import { comments as commentsTable } from "./comment.ts";
import { projectMembers as projectMembersTable } from "./member.ts";
import { projects as projectsTable } from "./project.ts";
import { projectStatusConfigs as projectStatusConfigsTable } from "./status-config.ts";
import { snapshots as snapshotsTable } from "./snapshot.ts";
import { tokens as tokensTable } from "./token.ts";
import { users as usersTable } from "./user.ts";
import { webhooks as webhooksTable } from "./webhook.ts";

/**
 * Database schema: table handles, row types, and the schema object passed
 * to the database client.
 *
 * Table handles are explicitly typed (JSR fast-check); exact column types
 * live on the narrow per-entity definitions, and the row interfaces are
 * pinned to them by `schema-types.test.ts`.
 */
export type { Baseline } from "./baseline.ts";
export type { Build } from "./build.ts";
export type { Comment } from "./comment.ts";
export type { BuildLabel, LabelType } from "./label.ts";
export type { ProjectMember } from "./member.ts";
export type { Project, StorybookMeta } from "./project.ts";
export type { ProjectStatusConfig } from "./status-config.ts";
export type { Snapshot } from "./snapshot.ts";
export type { Token } from "./token.ts";
export type { User } from "./user.ts";
export type { Webhook } from "./webhook.ts";

/** Projects table (one row per Storybook project). */
export const projects: AnySQLiteTable = projectsTable;
/** Project status-configs table (merge-gate configurations). */
export const projectStatusConfigs: AnySQLiteTable = projectStatusConfigsTable;
/** Builds table (one row per uploaded Storybook build). */
export const builds: AnySQLiteTable = buildsTable;
/** Snapshots table (one row per captured story screenshot). */
export const snapshots: AnySQLiteTable = snapshotsTable;
/** Baselines table (accepted reference snapshots per branch). */
export const baselines: AnySQLiteTable = baselinesTable;
/** Comments table (review comments on snapshots). */
export const comments: AnySQLiteTable = commentsTable;
/** Label-types table (project-defined build label vocabularies). */
export const labelTypes: AnySQLiteTable = labelTypesTable;
/** Build-labels table (labels attached to builds). */
export const buildLabels: AnySQLiteTable = buildLabelsTable;
/** Tokens table (CI token hashes per project). */
export const tokens: AnySQLiteTable = tokensTable;
/** Webhooks table (outgoing build-event subscriptions). */
export const webhooks: AnySQLiteTable = webhooksTable;
/** Users table (dashboard members). */
export const users: AnySQLiteTable = usersTable;
/** Project-members table (per-project memberships and roles). */
export const projectMembers: AnySQLiteTable = projectMembersTable;

/** Full Drizzle schema object passed to the database client. */
export const schema = {
  projects,
  projectStatusConfigs,
  builds,
  snapshots,
  baselines,
  comments,
  labelTypes,
  buildLabels,
  tokens,
  webhooks,
  users,
  projectMembers,
};

/** The full database schema type. */
export type Schema = typeof schema;
