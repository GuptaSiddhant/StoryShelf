import { int, mysqlTable, text, varchar } from "drizzle-orm/mysql-core";
import { datetime } from "./datetime.ts";
import { users } from "./user.ts";

/**
 * A device registered for web push (ADR 0048): the push service URL (unique) and the device's own
 * keys. Never log the three. Deleted with its user.
 */
export const pushSubscriptions = mysqlTable("push_subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  endpoint: varchar("endpoint", { length: 512 }).notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  label: text("label"),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
  lastSuccessAt: datetime("last_success_at", { mode: "string", fsp: 3 }),
  failureCount: int("failure_count").notNull().default(0),
});

/** Row type of `push_subscriptions`. */
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
