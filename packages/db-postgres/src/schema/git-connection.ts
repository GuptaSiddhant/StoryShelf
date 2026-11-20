import type { GitConnectionProvider, GitRepositoryLinkState } from "@storyshelf/core/schema";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { projects } from "./project.ts";

/** Narrow `git_connections` table definition: one credential per git host account (epic #1117). */
export const gitConnections = pgTable("git_connections", {
  id: text("id").primaryKey(),
  provider: text("provider").$type<GitConnectionProvider>().notNull(),
  name: text("name").notNull(),
  apiBase: text("api_base"),
  config: text("config").notNull(),
  secretEncrypted: text("secret_encrypted"),
  createdBy: text("created_by"),
  state: text("state").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
});

/** Narrow `git_repository_links` table definition: a project's link to one repository. */
export const gitRepositoryLinks = pgTable(
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
    outputs: text("outputs").notNull().default("{}"),
    installationId: text("installation_id"),
    requestedBy: text("requested_by"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
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
