/**
 * Neon (WebSocket pool) preset for the Postgres database adapter.
 *
 * Same schema, DDL, and Drizzle factory as the `postgres.js` default; only
 * the driver differs (`@neondatabase/serverless` pooled connections work on
 * Node and edge runtimes with a WebSocket constructor). Requires the
 * optional `@neondatabase/serverless` peer (`nub add @neondatabase/serverless`).
 */
import { Pool, type PoolClient } from "@neondatabase/serverless";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { drizzle } from "drizzle-orm/neon-serverless";
import { createDrizzlePgAdapter } from "./drizzle-factory-pg.ts";
import { runMigrations } from "./migrate.ts";
import { schema } from "./schema/index.ts";

declare const __PKG_VERSION__: string | undefined;

/**
 * Options for creating a Neon-backed DatabaseAdapter.
 *
 * When `client` (a `Pool` or `PoolClient`) is supplied, all other
 * connection options are ignored and the caller owns the lifecycle of the
 * client (teardown is a no-op). This is the hook for custom WebSocket
 * constructors and hermetic tests.
 */
export interface NeonDatabaseOptions {
  url?: string;
  connectionString?: string;
  client?: Pool | PoolClient;
}

/**
 * Create a Neon-backed DatabaseAdapter using Drizzle ORM.
 *
 * @param options - Either a connection `url` or a preconfigured Neon
 * `client`.
 * @returns A DatabaseAdapter backed by the Neon database.
 */
export function createNeonDatabase(options: NeonDatabaseOptions): DatabaseAdapter {
  const connectionString = options.connectionString ?? options.url;
  if (!options.client && !connectionString) {
    throw new Error(
      "createNeonDatabase: provide `url` (or `connectionString`) or a preconfigured `client`",
    );
  }

  const owned = !options.client;
  const pool = options.client ?? new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  return createDrizzlePgAdapter(db, {
    metadata: {
      name: "Neon",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "Neon Postgres database adapter (serverless driver + Drizzle)",
      kind: "neon",
      category: "database",
    },
    tables: schema,
    migrate: async () => {
      await runMigrations(async (sql) => (await pool.query(sql)).rows as unknown[]);
    },
    close: async () => {
      if (owned) {
        await endClient(pool);
      }
    },
    ping: async () => {
      await pool.query("SELECT 1");
    },
  });
}

/** Close an owned client: pools end, checked-out clients release. */
async function endClient(pool: Pool | PoolClient): Promise<void> {
  if ("end" in pool && typeof pool.end === "function") {
    await pool.end();
  } else if ("release" in pool && typeof pool.release === "function") {
    pool.release();
  }
}
