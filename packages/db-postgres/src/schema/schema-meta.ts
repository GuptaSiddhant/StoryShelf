import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Narrow `schema_meta` table definition: the release that last migrated the database (ADR 0053). */
export const schemaMeta = pgTable("schema_meta", {
  id: text("id").primaryKey(),
  version: text("version").notNull(),
  migratedAt: timestamp("migrated_at", { withTimezone: true, mode: "string" }).notNull(),
});
