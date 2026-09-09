import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { projects } from "./project.ts";

/** Narrow `project_status_configs` table definition. */
export const projectStatusConfigs = sqliteTable("project_status_configs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  config: text("config").notNull(),
  tokenEncrypted: text("token_encrypted").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
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
