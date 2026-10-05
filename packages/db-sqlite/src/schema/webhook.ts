import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { projects } from "./project.ts";

/** Narrow `webhooks` table definition. */
export const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  secretEncrypted: text("secret_encrypted").notNull(),
  events: text("events"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
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
