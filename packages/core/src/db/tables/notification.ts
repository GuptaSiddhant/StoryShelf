/** Webhooks and notification channels and subscriptions, as neutral tables. */
import { bool, id, text, timestamp } from "../columns.ts";
import { defineTable, index, uniqueIndex } from "../define-table.ts";

export const webhooks = defineTable("webhooks", {
  id: id("id").primaryKey(),
  projectId: id("project_id").notNull().references("projects", "id", "cascade"),
  url: text("url").notNull(),
  secretEncrypted: text("secret_encrypted").notNull(),
  events: text("events"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

/** A chat or email channel; a null `project_id` is a site-wide channel. */
export const notificationChannels = defineTable(
  "notification_channels",
  {
    id: id("id").primaryKey(),
    projectId: id("project_id").references("projects", "id", "cascade"),
    provider: text("provider").notNull(),
    config: text("config").notNull(),
    secretEncrypted: text("secret_encrypted"),
    events: text("events"),
    enabled: bool("enabled").notNull().default(true),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at"),
    lastDeliveredAt: timestamp("last_delivered_at"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  { indexes: [index("notification_channels_project_id_idx", ["projectId"])] },
);

export const notificationSubscriptions = defineTable(
  "notification_subscriptions",
  {
    id: id("id").primaryKey(),
    projectId: id("project_id").notNull().references("projects", "id", "cascade"),
    userId: id("user_id").notNull().references("users", "id", "cascade"),
    events: text("events"),
    via: text("via"),
    enabled: bool("enabled").notNull().default(true),
    reviewRequests: bool("review_requests").notNull().default(true),
    createdAt: timestamp("created_at").notNull(),
  },
  {
    indexes: [uniqueIndex("notification_subscriptions_project_user_idx", ["projectId", "userId"])],
  },
);
