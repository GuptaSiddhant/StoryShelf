/** `users` as a neutral table (spike #800; not wired into any adapter). */
import type { SiteRole } from "../../types.ts";
import { bool, id, key, text, timestamp } from "../columns.ts";
import { defineTable } from "../define-table.ts";

export const users = defineTable("users", {
  id: id("id").primaryKey(),
  email: key("email", 255).notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  role: key("role", 32).$type<SiteRole>().notNull().default("member"),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").notNull(),
  passwordHash: text("password_hash"),
  displayNameOverride: text("display_name_override"),
  authProvider: key("auth_provider", 32)
    .$type<"local" | "oidc" | "shared">()
    .notNull()
    .default("oidc"),
  disabled: bool("disabled").notNull().default(false),
});
