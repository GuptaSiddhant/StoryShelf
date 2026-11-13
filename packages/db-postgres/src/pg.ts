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
import { runMigrationsLocked, type MigrationSession } from "./migrate.ts";
import { pooledSession, singleSession } from "./migration-session.ts";
import {
  activateRetention,
  attachRetention,
  type RetentionActivation,
} from "./retention-activation.ts";
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
  /** Discrete connection fields, used when no `url` is given (the `rds-iam` preset). */
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  /** A password, or a function `pg` calls for every new connection (a fresh IAM token). */
  password?: string | (() => string | Promise<string>);
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
  if (!options.client && !connectionString && !options.host) {
    throw new Error(
      "createPgDatabase: provide `url` (or `connectionString`), `host`, or a preconfigured `client`",
    );
  }

  const owned = !options.client;
  const pool = options.client ?? newPool(options, connectionString);
  const db = drizzle(pool, { schema });
  const retention: RetentionActivation = {};
  // Only a pool hands each transaction its own session; one injected connection shares them all,
  // so row locks would prove nothing and the capability stays off.
  const pooled = owned || pool instanceof Pool;

  const adapter = createDrizzlePgAdapter(db, {
    metadata: {
      name: "Postgres (pg)",
      version: typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0",
      description: "Postgres database adapter (node-postgres + Drizzle)",
      kind: "pg",
      category: "database",
    },
    tables: schema,
    migrate: async ({ logger }) => {
      await runMigrationsLocked(sessionFor(pool), logger);
      if (pooled) {
        await activateRetention(db, retention);
      }
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
  return attachRetention(adapter, retention);
}

/** An owned pool from URL-or-fields options. */
function newPool(options: PgDatabaseOptions, connectionString: string | undefined): Pool {
  return new Pool({
    connectionString,
    host: options.host,
    port: options.port,
    database: options.database,
    user: options.user,
    password: options.password,
    ssl: options.ssl,
    max: options.max,
    idleTimeoutMillis: options.idleTimeoutMillis,
    connectionTimeoutMillis: options.connectionTimeoutMillis,
  });
}

/** Close an owned client: pools end, bare clients disconnect. */
async function endClient(pool: Pool | Client | PoolClient): Promise<void> {
  if ("end" in pool && typeof pool.end === "function") {
    await (pool as Pool).end();
  }
}

/** A pool gives the migration a dedicated connection; an injected client is already one session. */
function sessionFor(pool: Pool | Client | PoolClient): MigrationSession {
  return pool instanceof Pool ? pooledSession(pool) : singleSession(pool);
}
