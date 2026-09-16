import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { projects } from "./project.ts";

/** Narrow `tokens` table definition. */
export const tokens = sqliteTable("tokens", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  hash: text("hash").notNull(),
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at").notNull(),
});

/** A CI token row (hash only; the secret itself is never stored). */
export interface Token {
  id: string;
  projectId: string;
  name: string;
  hash: string;
  lastUsedAt: string | null;
  createdAt: string;
}
