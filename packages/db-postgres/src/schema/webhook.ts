import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { projects } from "./project.ts";

/** Narrow `webhooks` table definition. */
export const webhooks = pgTable("webhooks", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  secretEncrypted: text("secret_encrypted").notNull(),
  events: text("events"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
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
