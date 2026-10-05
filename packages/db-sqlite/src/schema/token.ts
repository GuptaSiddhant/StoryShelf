import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { projects } from "./project.ts";
import { users } from "./user.ts";

/** Narrow `tokens` table definition. */
export const tokens = sqliteTable("tokens", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  hash: text("hash").notNull(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at").notNull(),
});

/** A CI token row (hash only; the secret itself is never stored). */
export interface Token {
  id: string;
  projectId: string;
  name: string;
  hash: string;
  userId: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}
