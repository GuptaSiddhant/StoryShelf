/**
 * Database schema: table handles, row types, and the schema object passed
 * to the database client.
 *
 * Table handles are re-exported with their narrow per-entity types (not
 * widened) so generic adapters (`db.list(builds, …)`, `eq(builds.projectId,
 * …)`) keep full type inference through the `@storyshelf/core/schema`
 * subpath. Exact column types live on the narrow per-entity definitions,
 * and the row interfaces are pinned to them by `schema-types.test.ts`.
 */
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
 * Narrow table handles, re-exported so generic adapters keep full type
 * inference through the `@storyshelf/core/schema` subpath.
 */
export { baselines } from "./baseline.ts";
export { buildLabels, labelTypes } from "./label.ts";
export { builds } from "./build.ts";
export { comments } from "./comment.ts";
export { projectMembers } from "./member.ts";
export { projects } from "./project.ts";
export { projectStatusConfigs } from "./status-config.ts";
export { snapshots } from "./snapshot.ts";
export { tokens } from "./token.ts";
export { users } from "./user.ts";
export { webhooks } from "./webhook.ts";
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
export const schema = {
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
