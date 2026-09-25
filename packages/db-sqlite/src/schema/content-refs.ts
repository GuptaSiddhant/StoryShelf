import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Content-addressed storage refs for deduplicated Storybook assets. */
export const contentRefs = sqliteTable("content_refs", {
  hash: text("hash").primaryKey(),
  refCount: integer("ref_count").notNull().default(1),
  lastSeenAt: text("last_seen_at").notNull(),
  createdAt: text("created_at").notNull(),
});

/** Content ref row. */
export interface ContentRef {
  hash: string;
  refCount: number;
  lastSeenAt: string;
  createdAt: string;
}
