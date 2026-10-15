import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./user.ts";

/**
 * A user's own OAuth connection to an external service (Figma, later Jira/Linear/…),
 * one per user and service. `tokenEncrypted` is the access token; the refresh token
 * is encrypted too. `status` is `ok` or `expired` (needs reconnecting).
 */
export const userConnections = pgTable(
  "user_connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    service: text("service").notNull(),
    tokenEncrypted: text("token_encrypted").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
    status: text("status").notNull().default("ok"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [uniqueIndex("user_connections_user_service_idx").on(t.userId, t.service)],
);

/** Row type of `user_connections`. */
export type UserConnection = typeof userConnections.$inferSelect;
