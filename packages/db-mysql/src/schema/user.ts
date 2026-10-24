import type { SiteRole } from "@storyshelf/core/types";
import { mysqlTable, text } from "drizzle-orm/mysql-core";
import { datetime } from "./datetime.ts";

/** Narrow `users` table definition. */
export const users = mysqlTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  role: text("role").$type<SiteRole>().notNull().default("member"),
  lastLoginAt: datetime("last_login_at", { mode: "string", fsp: 3 }),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
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
