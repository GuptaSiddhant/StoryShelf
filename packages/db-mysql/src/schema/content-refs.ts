import { int, mysqlTable, text, datetime } from "drizzle-orm/mysql-core";

/** Content-addressed storage refs for deduplicated Storybook assets. */
export const contentRefs = mysqlTable("content_refs", {
  hash: text("hash").primaryKey(),
  refCount: int("ref_count").notNull().default(1),
  lastSeenAt: datetime("last_seen_at", { mode: "string", fsp: 3 }).notNull(),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
});

/** Content ref row. */
export interface ContentRef {
  hash: string;
  refCount: number;
  lastSeenAt: string;
  createdAt: string;
}
