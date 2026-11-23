import type { GitConnectionProvider, GitRepositoryLinkState } from "@storyshelf/core/schema";
import { index, mysqlTable, text, uniqueIndex } from "drizzle-orm/mysql-core";
import { datetime } from "./datetime.ts";
import { projects } from "./project.ts";

/** Narrow `git_connections` table definition: one credential per git host account (epic #1117). */
export const gitConnections = mysqlTable("git_connections", {
  id: text("id").primaryKey(),
  provider: text("provider").$type<GitConnectionProvider>().notNull(),
  name: text("name").notNull(),
  apiBase: text("api_base"),
  config: text("config").notNull(),
  secretEncrypted: text("secret_encrypted"),
  createdBy: text("created_by"),
  state: text("state").notNull().default("active"),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
  updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull(),
});

/** Narrow `git_repository_links` table definition: a project's link to one repository. */
export const gitRepositoryLinks = mysqlTable(
  "git_repository_links",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => gitConnections.id),
    host: text("host").notNull(),
    owner: text("owner").notNull(),
    repo: text("repo").notNull(),
    hostRepositoryId: text("host_repository_id"),
    prefix: text("prefix").notNull().default(""),
    state: text("state").$type<GitRepositoryLinkState>().notNull().default("pending"),
    reason: text("reason"),
    outputs: text("outputs").notNull(),
    installationId: text("installation_id"),
    requestedBy: text("requested_by"),
    approvedBy: text("approved_by"),
    approvedAt: datetime("approved_at", { mode: "string", fsp: 3 }),
    lastDeliveredAt: datetime("last_delivered_at", { mode: "string", fsp: 3 }),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull(),
  },
  (t) => [
    uniqueIndex("git_repository_links_repository_idx").on(t.host, t.owner, t.repo, t.prefix),
    index("git_repository_links_project_id_idx").on(t.projectId),
    index("git_repository_links_connection_id_idx").on(t.connectionId),
  ],
);

/** Git connection row. */
export type GitConnection = typeof gitConnections.$inferSelect;
/** Git repository link row. */
export type GitRepositoryLink = typeof gitRepositoryLinks.$inferSelect;
