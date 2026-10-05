import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./user.ts";

/** Invite token for local accounts (one-time, hashed at rest). */
export const userInviteTokens = sqliteTable("user_invite_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull(),
});

/** A user invite token row. */
export interface UserInviteToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}
