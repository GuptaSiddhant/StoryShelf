import type { SiteRole } from "@storyshelf/core/types";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Narrow `users` table definition. */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  role: text("role").$type<SiteRole>().notNull().default("member"),
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at").notNull(),
  passwordHash: text("password_hash"),
  displayNameOverride: text("display_name_override"),
  authProvider: text("auth_provider")
    .$type<"local" | "oidc" | "shared">()
    .notNull()
    .default("oidc"),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
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
