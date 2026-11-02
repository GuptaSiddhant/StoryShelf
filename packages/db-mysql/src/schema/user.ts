import type { SiteRole } from "@storyshelf/core/types";
import { boolean, mysqlTable, text } from "drizzle-orm/mysql-core";
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
  passwordHash: text("password_hash"),
  displayNameOverride: text("display_name_override"),
  authProvider: text("auth_provider")
    .$type<"local" | "oidc" | "shared">()
    .notNull()
    .default("oidc"),
  disabled: boolean("disabled").notNull().default(false),
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
  passwordHash: string | null;
  displayNameOverride: string | null;
  authProvider: "local" | "oidc" | "shared";
  disabled: boolean;
}
