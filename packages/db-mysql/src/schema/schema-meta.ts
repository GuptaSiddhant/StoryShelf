import { mysqlTable, text } from "drizzle-orm/mysql-core";
import { datetime } from "./datetime.ts";

/** Narrow `schema_meta` table definition: the release that last migrated the database (ADR 0053). */
export const schemaMeta = mysqlTable("schema_meta", {
  id: text("id").primaryKey(),
  version: text("version").notNull(),
  migratedAt: datetime("migrated_at", { mode: "string", fsp: 3 }).notNull(),
});
