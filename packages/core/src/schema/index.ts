/**
 * Database schema: one module per entity, mirroring `models/`.
 *
 * Each entity module exports its narrow Drizzle table definition plus the
 * hand-written row interface (pinned to `$inferSelect` by
 * `schema-types.test.ts`). This index re-exports everything and assembles
 * the `schema` object passed to the database client.
 */
export * from "./baseline.ts";
export * from "./build.ts";
export * from "./comment.ts";
export * from "./label.ts";
export * from "./member.ts";
export * from "./project.ts";
export * from "./snapshot.ts";
export * from "./status-config.ts";
export * from "./token.ts";
export * from "./user.ts";
export * from "./webhook.ts";
import { baselines } from "./baseline.ts";
import { builds } from "./build.ts";
import { comments } from "./comment.ts";
import { buildLabels, labelTypes } from "./label.ts";
import { projectMembers } from "./member.ts";
import { projects } from "./project.ts";
import { snapshots } from "./snapshot.ts";
import { projectStatusConfigs } from "./status-config.ts";
import { tokens } from "./token.ts";
import { users } from "./user.ts";
import { webhooks } from "./webhook.ts";

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
