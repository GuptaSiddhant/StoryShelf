import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Narrow `schema_meta` table definition: the release that last migrated the database (ADR 0053). */
export const schemaMeta = sqliteTable("schema_meta", {
  id: text("id").primaryKey(),
  version: text("version").notNull(),
  migratedAt: text("migrated_at").notNull(),
});
