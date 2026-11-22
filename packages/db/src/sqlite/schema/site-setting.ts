import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Narrow `site_settings` table definition: key-value facts the app learns at runtime. */
export const siteSettings = sqliteTable("site_settings", {
  id: text("id").primaryKey(),
  value: text("value").notNull(),
  updatedBy: text("updated_by"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
