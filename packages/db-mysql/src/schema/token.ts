import { mysqlTable, text, datetime } from "drizzle-orm/mysql-core";
import { projects } from "./project.ts";
import { users } from "./user.ts";

/** Narrow `tokens` table definition. */
export const tokens = mysqlTable("tokens", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  hash: text("hash").notNull(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  lastUsedAt: datetime("last_used_at", { mode: "string", fsp: 3 }),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
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
