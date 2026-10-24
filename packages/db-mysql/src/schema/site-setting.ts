import { mysqlTable, text } from "drizzle-orm/mysql-core";
import { datetime } from "./datetime.ts";

/** Narrow `site_settings` table definition: key-value facts the app learns at runtime. */
export const siteSettings = mysqlTable("site_settings", {
  id: text("id").primaryKey(),
  value: text("value").notNull(),
  updatedBy: text("updated_by"),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
  updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull(),
});
