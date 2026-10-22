import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Narrow `site_settings` table definition: key-value facts the app learns at runtime. */
export const siteSettings = pgTable("site_settings", {
  id: text("id").primaryKey(),
  value: text("value").notNull(),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
});
