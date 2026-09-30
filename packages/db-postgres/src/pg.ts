/**
 * node-postgres preset for the Postgres database adapter.
 *
 * Same schema, DDL, and Drizzle factory as the `postgres.js` default; only
 * the driver differs. `node-postgres` uses unnamed portals, so it works
 * behind transaction-mode poolers (PgBouncer, Supavisor, Neon pooled)
 * without `prepare: false`, and it plugs into IAM flows (RDS token
 * password, Cloud SQL connector) that hand out `pg`-shaped clients.
 * Requires the optional `pg` peer (`nub add pg`).
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type Client, type PoolClient } from "pg";
import { createDrizzlePgAdapter } from "./drizzle-factory-pg.ts";
import { runMigrations } from "./migrate.ts";
import { schema } from "./schema/index.ts";

declare const __PKG_VERSION__: string | undefined;

/**
 * Options for creating a node-postgres-backed DatabaseAdapter.
 *
 * When `client` (a `Pool`, `Client`, or `PoolClient`) is supplied, all other
 * connection options are ignored and the caller owns the lifecycle of the
 * client (teardown is a no-op). This is the hook for IAM token refresh,
 * Cloud SQL connectors, and hermetic tests.
 */
export interface PgDatabaseOptions {
  url?: string;
  connectionString?: string;
  ssl?: unknown;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  client?: Pool | Client | PoolClient;
}

/**
 * Create a node-postgres-backed DatabaseAdapter using Drizzle ORM.
 *
 * @param options - Either a connection `url` (plus pooling/TLS options) or
 * a preconfigured `pg` `client`.
 * @returns A DatabaseAdapter backed by Postgres.
 */
export function createPgDatabase(options: PgDatabaseOptions): DatabaseAdapter {
  const connectionString = options.connectionString ?? options.url;
  if (!options.client && !connectionString) {
    throw new Error(
      "createPgDatabase: provide `url` (or `connectionString`) or a preconfigured `client`",
    );
  }

  const owned = !options.client;
  const pool =
    options.client ??
    new Pool({
      connectionString,
      ssl: options.ssl,
      max: options.max,
      idleTimeoutMillis: options.idleTimeoutMillis,
      connectionTimeoutMillis: options.connectionTimeoutMillis,
    });
  const db = drizzle(pool, { schema });

  return createDrizzlePgAdapter(db, {
    metadata: {
      name: "Postgres (pg)",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "Postgres database adapter (node-postgres + Drizzle)",
      kind: "pg",
      category: "database",
    },
    tables: schema,
    migrate: async () => {
      await runMigrations(async (sql) => (await pool.query(sql)).rows);
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

/** Close an owned client: pools end, bare clients disconnect. */
async function endClient(pool: Pool | Client | PoolClient): Promise<void> {
  if ("end" in pool && typeof pool.end === "function") {
    await (pool as Pool).end();
  }
}
