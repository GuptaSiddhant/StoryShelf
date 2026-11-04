import { index, mysqlTable, primaryKey, varchar } from "drizzle-orm/mysql-core";
import { datetime } from "./datetime.ts";

/** A build's use of one shared content blob; see the core `ContentUse` row type. */
export const contentUses = mysqlTable(
  "content_uses",
  {
    buildId: varchar("build_id", { length: 64 }).notNull(),
    contentHash: varchar("content_hash", { length: 128 }).notNull(),
    projectId: varchar("project_id", { length: 64 }).notNull(),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
    releasedAt: datetime("released_at", { mode: "string", fsp: 3 }),
    collectingAt: datetime("collecting_at", { mode: "string", fsp: 3 }),
    claimToken: varchar("claim_token", { length: 64 }),
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
