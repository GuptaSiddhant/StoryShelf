import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./user.ts";

/**
 * A device registered for web push (ADR 0048): the push service URL (unique) and the device's own
 * keys. Never log the three. Deleted with its user.
 */
export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  label: text("label"),
  createdAt: text("created_at").notNull(),
  lastSuccessAt: text("last_success_at"),
  failureCount: integer("failure_count").notNull().default(0),
});

/** Row type of `push_subscriptions`. */
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
