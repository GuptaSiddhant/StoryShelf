/** `site_settings` and `schema_meta`, the app's own key-value tables, as neutral tables. */
import { id, text, timestamp } from "../columns.ts";
import { defineTable } from "../define-table.ts";

/** Key-value facts the app learns at runtime (ADR 0007, decision 6). */
export const siteSettings = defineTable("site_settings", {
  id: id("id").primaryKey(),
  value: text("value").notNull(),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

/** The release that last migrated the database (ADR 0053, decision 2). */
export const schemaMeta = defineTable("schema_meta", {
  id: id("id").primaryKey(),
  version: text("version").notNull(),
  migratedAt: timestamp("migrated_at").notNull(),
});
