import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** A build's use of one shared content blob; see the core `ContentUse` row type. */
export const contentUses = sqliteTable(
  "content_uses",
  {
    buildId: text("build_id").notNull(),
    contentHash: text("content_hash").notNull(),
    projectId: text("project_id").notNull(),
    createdAt: text("created_at").notNull(),
    sizeBytes: integer("size_bytes"),
    releasedAt: text("released_at"),
    collectingAt: text("collecting_at"),
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
  sizeBytes: number | null;
  releasedAt: string | null;
  collectingAt: string | null;
  claimToken: string | null;
}
