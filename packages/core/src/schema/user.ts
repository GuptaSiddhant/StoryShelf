import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { SiteRole } from "../types.ts";

/** Narrow `users` table definition. */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  role: text("role").$type<SiteRole>().notNull().default("member"),
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at").notNull(),
});

/** A user row. */
export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: SiteRole;
  lastLoginAt: string | null;
  createdAt: string;
}
