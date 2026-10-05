import { mysqlTable, text, datetime } from "drizzle-orm/mysql-core";
import { projects } from "./project.ts";

/** Narrow `project_status_configs` table definition. */
export const projectStatusConfigs = mysqlTable("project_status_configs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  config: text("config").notNull(),
  tokenEncrypted: text("token_encrypted").notNull(),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
  updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull(),
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
