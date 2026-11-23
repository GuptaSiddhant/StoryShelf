import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createMysqlAdapter, type MysqlDatabaseOptions } from "./index.ts";

/**
 * PlanetScale (serverless MySQL HTTP) preset.
 * For now an alias over the mysql2 pool — PlanetScale's HTTP driver
 * (`@planetscale/database` + `drizzle-orm/planetscale-serverless`) is wire-compatible
 * and can be swapped when the optional peer is installed. This preset ensures
 * the CLI import `db-mysql/planetscale` resolves and the generated server
 * documents the intent.
 */
export type PlanetscaleDatabaseOptions = MysqlDatabaseOptions;

export function createPlanetscaleDatabase(options: PlanetscaleDatabaseOptions): DatabaseAdapter {
  // Build retention (ADR 0039) was never proven on PlanetScale: it stays fail closed.
  return createMysqlAdapter(options, "the PlanetScale preset is not verified for build retention");
}
