import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./user.ts";

/**
 * A device registered for web push (ADR 0048): the push service URL (unique) and the device's own
 * keys. Never log the three. Deleted with its user.
 */
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  label: text("label"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true, mode: "string" }),
  failureCount: integer("failure_count").notNull().default(0),
});

/** Row type of `push_subscriptions`. */
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
