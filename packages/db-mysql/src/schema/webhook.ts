import { mysqlTable, text, datetime } from "drizzle-orm/mysql-core";
import { projects } from "./project.ts";

/** Narrow `webhooks` table definition. */
export const webhooks = mysqlTable("webhooks", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  secretEncrypted: text("secret_encrypted").notNull(),
  events: text("events"),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
  updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull(),
});

/** A webhook subscription row. */
export interface Webhook {
  id: string;
  projectId: string;
  url: string;
  secretEncrypted: string;
  events: string | null;
  createdAt: string;
  updatedAt: string;
}
