/** Boot comparison for the synchronous SQLite drivers (ADR 0053, decision 2). */
import { gatedMigration, sqlSchemaLevelStore } from "@storyshelf/core/adapter/database";
import type { Logger } from "@storyshelf/core/logger";

/** The two calls a synchronous driver offers: run a statement, or read rows. */
export interface SyncSql {
  exec: (sql: string) => void;
  all: (sql: string) => unknown[];
}

/**
 * Turn foreign keys on (a connection setting, needed whether or not migrations run), then migrate,
 * skip or refuse by the release recorded in `schema_meta`.
 */
export async function gatedSyncMigration(
  sql: SyncSql,
  input: { release: string | undefined; logger: Logger | undefined; migrate: () => Promise<void> },
): Promise<void> {
  sql.exec("PRAGMA foreign_keys = ON");
  await gatedMigration({
    ...input,
    store: sqlSchemaLevelStore(async (statement) => {
      if (!/^\s*select/iu.test(statement)) {
        sql.exec(statement);
        return [];
      }
      return await Promise.resolve(sql.all(statement));
    }, "sqlite"),
  });
}
