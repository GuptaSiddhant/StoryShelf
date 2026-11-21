import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { projects } from "./project.ts";
import { users } from "./user.ts";

/** Narrow `tokens` table definition. */
export const tokens = pgTable("tokens", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  hash: text("hash").notNull(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
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
