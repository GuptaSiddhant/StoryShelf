import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createMysqlDatabase, type MysqlDatabaseOptions } from "./index.ts";

/**
 * TiDB Serverless (MySQL wire, serverless) preset.
 * Alias over the mysql2 pool — TiDB's serverless driver
 * (`@tidbcloud/serverless` + `drizzle-orm/tidb-serverless`) is
 * wire-compatible and can be swapped when the optional peer is installed.
 */
export type TidbDatabaseOptions = MysqlDatabaseOptions;

export function createTidbDatabase(options: TidbDatabaseOptions): DatabaseAdapter {
  return createMysqlDatabase(options);
}
