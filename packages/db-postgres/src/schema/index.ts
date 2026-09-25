/**
 * Database schema: table handles, row types, and the schema object passed
 * to the database client.
 *
 * Table handles are available on the `schema` object with full type
 * inference (`schema.builds`, …); exact column types live on the narrow
 * per-entity definitions, and the row interfaces are pinned to them by
 * `schema-types.test.ts`.
 */
import type { AnyPgTable } from "drizzle-orm/pg-core";
import { baselines as baselinesTable } from "./baseline.ts";
import { builds as buildsTable } from "./build.ts";
import { comments as commentsTable } from "./comment.ts";
import { contentRefs as contentRefsTable } from "./content-refs.ts";
import { buildLabels as buildLabelsTable, labelTypes as labelTypesTable } from "./label.ts";
import { projectMembers as projectMembersTable } from "./member.ts";
import { projectGroupMappings as projectGroupMappingsTable } from "./project-group-mapping.ts";
import { projects as projectsTable } from "./project.ts";
import { snapshots as snapshotsTable } from "./snapshot.ts";
import { projectStatusConfigs as projectStatusConfigsTable } from "./status-config.ts";
import { tokens as tokensTable } from "./token.ts";
import { users as usersTable } from "./user.ts";
import { webhooks as webhooksTable } from "./webhook.ts";

export { builds } from "./build.ts";
export { baselines } from "./baseline.ts";
export { comments } from "./comment.ts";
export { buildLabels, labelTypes } from "./label.ts";
export { projectMembers } from "./member.ts";
export { projectGroupMappings } from "./project-group-mapping.ts";
export { projects } from "./project.ts";
export { snapshots } from "./snapshot.ts";
export { projectStatusConfigs } from "./status-config.ts";
export { tokens } from "./token.ts";
export { users } from "./user.ts";
export { webhooks } from "./webhook.ts";
export { contentRefs } from "./content-refs.ts";

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
/** Per-project git provider status-check configuration row. */
export type { ProjectStatusConfig } from "./status-config.ts";
/** Snapshot row capturing a single story at one viewport. */
export type { Snapshot } from "./snapshot.ts";
/** CI token row (stores only the hash). */
export type { Token } from "./token.ts";
/** User row for authenticated identities. */
export type { User } from "./user.ts";
/** Webhook subscription row. */
export type { Webhook } from "./webhook.ts";
/** Baseline row. */
export type { Baseline } from "./baseline.ts";
/** Content ref row for deduplicated assets. */
export type { ContentRef } from "./content-refs.ts";

/** Full Drizzle schema object passed to the database client. */
export const schema: {
  projects: AnyPgTable;
  projectStatusConfigs: AnyPgTable;
  builds: AnyPgTable;
  snapshots: AnyPgTable;
  baselines: AnyPgTable;
  comments: AnyPgTable;
  labelTypes: AnyPgTable;
  buildLabels: AnyPgTable;
  tokens: AnyPgTable;
  webhooks: AnyPgTable;
  users: AnyPgTable;
  projectMembers: AnyPgTable;
  projectGroupMappings: AnyPgTable;
  contentRefs: AnyPgTable;
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
  projectGroupMappings: projectGroupMappingsTable,
  contentRefs: contentRefsTable,
};

/** The full database schema type. */
export type Schema = typeof schema;
