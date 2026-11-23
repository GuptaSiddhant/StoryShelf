/**
 * The web push devices (ADR 0048) as a neutral table: the push service URL (unique) and the
 * device's own keys. None of the three is ever logged. Deleted with its user.
 */
import { id, int, key, text, timestamp } from "../columns.ts";
import { defineTable } from "../define-table.ts";

export const pushSubscriptions = defineTable("push_subscriptions", {
  id: id("id").primaryKey(),
  userId: id("user_id").notNull().references("users", "id", "cascade"),
  endpoint: key("endpoint", 512).notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  label: text("label"),
  createdAt: timestamp("created_at").notNull(),
  lastSuccessAt: timestamp("last_success_at"),
  failureCount: int("failure_count").notNull().default(0),
});
