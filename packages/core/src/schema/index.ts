/**
 * Database schema: table handles, row types, and the schema object passed
 * to the database client.
 *
 * Table handles are available on the `schema` object with full type
 * inference (`schema.builds`, …); exact column types live on the narrow
 * per-entity definitions, and the row interfaces are pinned to them by
 * `schema-types.test.ts`.
 */
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import { baselines as baselinesTable } from "./baseline.ts";
import { builds as buildsTable } from "./build.ts";
import { comments as commentsTable } from "./comment.ts";
import { buildLabels as buildLabelsTable, labelTypes as labelTypesTable } from "./label.ts";
import { projectMembers as projectMembersTable } from "./member.ts";
import { projects as projectsTable } from "./project.ts";
import { snapshots as snapshotsTable } from "./snapshot.ts";
import { projectStatusConfigs as projectStatusConfigsTable } from "./status-config.ts";
import { tokens as tokensTable } from "./token.ts";
import { users as usersTable } from "./user.ts";
import { webhooks as webhooksTable } from "./webhook.ts";

/**
 * Row types for each table.
 */
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

/** Full Drizzle schema object passed to the database client. */
export const schema: {
  projects: AnySQLiteTable;
  projectStatusConfigs: AnySQLiteTable;
  builds: AnySQLiteTable;
  snapshots: AnySQLiteTable;
  baselines: AnySQLiteTable;
  comments: AnySQLiteTable;
  labelTypes: AnySQLiteTable;
  buildLabels: AnySQLiteTable;
  tokens: AnySQLiteTable;
  webhooks: AnySQLiteTable;
  users: AnySQLiteTable;
  projectMembers: AnySQLiteTable;
} = {
  projects: projectsTable,
  projectStatusConfigs: projectStatusConfigsTable,
  builds: buildsTable,
  snapshots: snapshotsTable,
  baselines: baselinesTable,
  comments: commentsTable,
  labelTypes: labelTypesTable,
  buildLabels: buildLabelsTable,
  tokens: tokensTable,
  webhooks: webhooksTable,
  users: usersTable,
  projectMembers: projectMembersTable,
};

/** The full database schema type. */
export type Schema = typeof schema;
