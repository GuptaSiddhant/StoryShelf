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
import type { Logger } from "@storyshelf/core/logger";
import { drizzle } from "drizzle-orm/neon-serverless";
import {
  assertPostgresUrl,
  createNoticeSink,
  nameFailure,
  routeNotices,
  type NoticeSink,
} from "./connection.ts";
import { createDrizzlePgAdapter } from "./drizzle-factory-pg.ts";
import { runMigrationsLocked, type MigrationSession } from "./migrate.ts";
import { pooledSession, singleSession } from "./migration-session.ts";
import {
  activateRetention,
  activateRetentionReadOnly,
  attachRetention,
  type RetentionActivation,
} from "./retention-activation.ts";
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
  const { connectionString, owned, sink, pool } = openPool(options);
  const db = drizzle({ client: pool });
  const retention: RetentionActivation = {};
  // Only a pool hands each transaction its own session; one injected connection shares them all,
  // so row locks would prove nothing and the capability stays off.
  const pooled = owned || pool instanceof Pool;

  const adapter = createDrizzlePgAdapter(db, {
    metadata: {
      name: "Neon",
      version: typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0",
      description: "Neon Postgres database adapter (serverless driver + Drizzle)",
      kind: "neon",
      category: "database",
    },
    tables: schema,
    migrate: async ({ logger, release }) => {
      if (logger) {
        sink.attach(logger);
      }
      await nameFailure(owned ? connectionString : undefined, async () => {
        await migrateAndActivate(pool, db, retention, pooled, logger, release);
      });
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
  return attachRetention(
    adapter,
    retention,
    pooled
      ? async (context) => {
          await activateRetentionReadOnly(db, retention, context);
        }
      : undefined,
  );
}

/** Close an owned client: pools end, checked-out clients release. */
async function endClient(pool: Pool | PoolClient): Promise<void> {
  if ("end" in pool && typeof pool.end === "function") {
    await pool.end();
  } else if ("release" in pool && typeof pool.release === "function") {
    pool.release();
  }
}

/** A pool gives the migration a dedicated connection; an injected client is already one session. */
function sessionFor(pool: Pool | PoolClient): MigrationSession {
  return pool instanceof Pool ? pooledSession(pool) : singleSession(pool);
}

/** The migration on its own session, then retention where each transaction has a session of its own. */
async function migrateAndActivate(
  pool: Pool | PoolClient,
  db: Parameters<typeof activateRetention>[0],
  retention: RetentionActivation,
  pooled: boolean,
  logger: Logger | undefined,
  release: string | undefined,
): Promise<void> {
  await runMigrationsLocked(sessionFor(pool), logger, release);
  if (pooled) {
    await activateRetention(db, retention);
  }
}

/** The caller's client, or an owned pool for the (checked) connection string, with its notices routed to the sink. */
function openPool(options: NeonDatabaseOptions): {
  connectionString: string | undefined;
  owned: boolean;
  sink: NoticeSink;
  pool: Pool | PoolClient;
} {
  const connectionString = options.connectionString ?? options.url;
  assertConnectable(options, connectionString);
  const owned = !options.client;
  const sink = createNoticeSink();
  const pool = options.client ?? new Pool({ connectionString });
  if (owned) {
    routeNotices(pool, sink);
  }
  return { connectionString, owned, sink, pool };
}

/** Refuse options that name no connection, or a connection string that is not a Postgres URL. */
function assertConnectable(
  options: NeonDatabaseOptions,
  connectionString: string | undefined,
): void {
  if (!options.client && !connectionString) {
    throw new Error(
      "createNeonDatabase: provide `url` (or `connectionString`) or a preconfigured `client`",
    );
  }
  if (connectionString) {
    assertPostgresUrl(connectionString);
  }
}
