import { boolean, datetime, mysqlTable, text } from "drizzle-orm/mysql-core";
import { projects } from "./project.ts";
import { users } from "./user.ts";

/** Narrow `notification_channels` table definition. */
export const notificationChannels = mysqlTable("notification_channels", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  config: text("config").notNull(),
  secretEncrypted: text("secret_encrypted"),
  events: text("events"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
  updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull(),
});

/** Narrow `notification_subscriptions` table definition. */
export const notificationSubscriptions = mysqlTable("notification_subscriptions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  events: text("events"),
  via: text("via"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
});

/** A notification channel row. */
export interface NotificationChannel {
  id: string;
  projectId: string | null;
  provider: string;
  config: string;
  secretEncrypted: string | null;
  events: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A per-user notification subscription row. */
export interface NotificationSubscription {
  id: string;
  projectId: string;
  userId: string;
  events: string | null;
  via: string | null;
  enabled: boolean;
  createdAt: string;
}
