import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { projects } from "./project.ts";

/** Narrow `project_status_configs` table definition. */
export const projectStatusConfigs = pgTable("project_status_configs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  config: text("config").notNull(),
  tokenEncrypted: text("token_encrypted").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
});

/** A project status-config row. */
export interface ProjectStatusConfig {
  id: string;
  projectId: string;
  provider: string;
  config: string;
  tokenEncrypted: string;
  createdAt: string;
  updatedAt: string;
}
