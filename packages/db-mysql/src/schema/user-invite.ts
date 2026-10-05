import { mysqlTable, text, datetime } from "drizzle-orm/mysql-core";
import { users } from "./user.ts";

/** Invite token for local accounts (one-time, hashed at rest). */
export const userInviteTokens = mysqlTable("user_invite_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: datetime("expires_at", { mode: "string", fsp: 3 }).notNull(),
  usedAt: datetime("used_at", { mode: "string", fsp: 3 }),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
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
