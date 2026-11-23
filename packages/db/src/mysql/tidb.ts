import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createMysqlAdapter, type MysqlDatabaseOptions } from "./index.ts";

/**
 * TiDB Serverless (MySQL wire, serverless) preset.
 * Alias over the mysql2 pool — TiDB's serverless driver
 * (`@tidbcloud/serverless` + `drizzle-orm/tidb-serverless`) is
 * wire-compatible and can be swapped when the optional peer is installed.
 */
export type TidbDatabaseOptions = MysqlDatabaseOptions;

export function createTidbDatabase(options: TidbDatabaseOptions): DatabaseAdapter {
  // Build retention (ADR 0039) was never proven on TiDB Serverless: it stays fail closed.
  return createMysqlAdapter(
    options,
    "the TiDB Serverless preset is not verified for build retention",
  );
}
