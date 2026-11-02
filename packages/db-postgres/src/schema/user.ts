import type { SiteRole } from "@storyshelf/core/types";
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Narrow `users` table definition. */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  role: text("role").$type<SiteRole>().notNull().default("member"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
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
