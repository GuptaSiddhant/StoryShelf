import { mysqlTable, text, uniqueIndex } from "drizzle-orm/mysql-core";
import { datetime } from "./datetime.ts";
import { users } from "./user.ts";

/**
 * A user's own OAuth connection to an external service (Figma, later Jira/Linear/…),
 * one per user and service. `tokenEncrypted` is the access token; the refresh token
 * is encrypted too. `status` is `ok` or `expired` (needs reconnecting).
 */
export const userConnections = mysqlTable(
  "user_connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    service: text("service").notNull(),
    tokenEncrypted: text("token_encrypted").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    expiresAt: datetime("expires_at", { mode: "string", fsp: 3 }),
    status: text("status").notNull().default("ok"),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull(),
  },
  (t) => [uniqueIndex("user_connections_user_service_idx").on(t.userId, t.service)],
);

/** Row type of `user_connections`. */
export type UserConnection = typeof userConnections.$inferSelect;
