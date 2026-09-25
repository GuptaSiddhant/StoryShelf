import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Content-addressed storage refs for deduplicated Storybook assets. */
export const contentRefs = pgTable("content_refs", {
  hash: text("hash").primaryKey(),
  refCount: integer("ref_count").notNull().default(1),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
});

/** Content ref row. */
export interface ContentRef {
  hash: string;
  refCount: number;
  lastSeenAt: string;
  createdAt: string;
}
