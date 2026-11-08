import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/** A build's use of one shared content blob; see the core `ContentUse` row type. */
export const contentUses = pgTable(
  "content_uses",
  {
    buildId: text("build_id").notNull(),
    contentHash: text("content_hash").notNull(),
    projectId: text("project_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true, mode: "string" }),
    collectingAt: timestamp("collecting_at", { withTimezone: true, mode: "string" }),
    claimToken: text("claim_token"),
  },
  (table) => [
    primaryKey({ columns: [table.buildId, table.contentHash] }),
    index("content_uses_hash_idx").on(table.contentHash),
  ],
);

/** Content use row. */
export interface ContentUse {
  buildId: string;
  contentHash: string;
  projectId: string;
  createdAt: string;
  releasedAt: string | null;
  collectingAt: string | null;
  claimToken: string | null;
}
