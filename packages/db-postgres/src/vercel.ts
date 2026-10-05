import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
/**
 * Vercel Postgres preset for the Postgres database adapter.
 *
 * Same schema, DDL, and Drizzle factory as the `postgres.js` default;
 * only the driver differs (`@vercel/postgres`, zero-config on Vercel via
 * `POSTGRES_URL`). Requires the optional `@vercel/postgres` peer
 * (`nub add @vercel/postgres`).
 */
import { sql, type VercelClient } from "@vercel/postgres";
import { drizzle } from "drizzle-orm/vercel-postgres";
import { createDrizzlePgAdapter } from "./drizzle-factory-pg.ts";
import { runMigrations } from "./migrate.ts";
import { schema } from "./schema/index.ts";

declare const __PKG_VERSION__: string | undefined;

/**
 * Options for creating a Vercel-backed DatabaseAdapter.
 *
 * With no options, the platform default `sql` client (bound to
 * `POSTGRES_URL`) is used and the caller owns nothing. Pass `client` to
 * inject a preconfigured client instead (teardown stays a no-op either
 * way — the platform owns the connection).
 */
export interface VercelDatabaseOptions {
  client?: VercelClient;
}

/**
 * Create a Vercel-backed DatabaseAdapter using Drizzle ORM.
 *
 * @param options - Optionally a preconfigured `@vercel/postgres` client.
 * @returns A DatabaseAdapter backed by Vercel Postgres.
 */
export function createVercelDatabase(options: VercelDatabaseOptions = {}): DatabaseAdapter {
  const client = options.client ?? sql;
  const db = drizzle(client, { schema });

  return createDrizzlePgAdapter(db, {
    metadata: {
      name: "Vercel Postgres",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "Vercel Postgres database adapter (@vercel/postgres + Drizzle)",
      kind: "vercel",
      category: "database",
    },
    tables: schema,
    migrate: async () => {
      await runMigrations(async (statement) => (await client.query(statement)).rows);
    },
    close: () => {
      // no-op: the platform owns the connection
    },
    ping: async () => {
      await client.query("SELECT 1");
    },
  });
}
