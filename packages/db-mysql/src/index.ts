import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { createDrizzleMySqlAdapter } from "./drizzle-factory-mysql.ts";
import type { LifecyclePool } from "./lifecycle-transaction.ts";
import { runMigrations } from "./migrate.ts";
import {
  activateRetention,
  attachRetention,
  type RetentionActivation,
  type RetentionSource,
} from "./retention-activation.ts";
import { schema } from "./schema/index.ts";

declare const __PKG_VERSION__: string | undefined;

export interface MysqlDatabaseOptions {
  url?: string;
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: unknown;
  connectionLimit?: number;
  client?: mysql.Pool | mysql.Connection;
}

type PoolLike = {
  query(sql: string): Promise<unknown>;
  execute?(sql: string): Promise<unknown>;
  end?(): Promise<void>;
};

function resolvePool(options: MysqlDatabaseOptions): {
  pool: PoolLike;
  owned: boolean;
} {
  if (options.client) {
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- Pool vs PoolLike width
    return { pool: options.client as unknown as PoolLike, owned: false };
  }
  const connectionString = options.connectionString ?? options.url;
  if (connectionString) {
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- Pool vs PoolLike width
    return {
      pool: mysql.createPool({
        uri: connectionString,
        ...(options.ssl === undefined ? {} : { ssl: options.ssl as never }),
        dateStrings: true,
      }),
      owned: true,
    };
  }
  if (options.host) {
    return {
      // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- Pool vs PoolLike width
      pool: mysql.createPool({
        host: options.host,
        port: options.port,
        user: options.user,
        password: options.password,
        database: options.database,
        ssl: options.ssl as never,
        dateStrings: true,
        waitForConnections: true,
        connectionLimit: options.connectionLimit ?? 10,
      }) as unknown as PoolLike,
      owned: true,
    };
  }
  throw new Error(
    "createMysqlDatabase: provide `url`/`connectionString`/`host` or a preconfigured `client`",
  );
}

/**
 * Where retention may get its connections: only a pool lends each operation a session of its own.
 * An injected single `Connection` would put every party on one session, where row locks prove
 * nothing, so it stays fail closed, as a preset that names why does.
 */
function retentionSource(pool: PoolLike, refused: string | undefined): RetentionSource {
  if (refused !== undefined) return { refused };
  if (typeof (pool as Partial<LifecyclePool>).getConnection !== "function") {
    return { refused: "an injected single connection, not a pool" };
  }
  return { pool: pool as unknown as LifecyclePool };
}

/**
 * Create a MySQL/MariaDB-backed DatabaseAdapter using mysql2 + Drizzle.
 * Works with MySQL, MariaDB, PlanetScale (via mysql2), TiDB.
 *
 * Build retention (ADR 0039) is available on a pool against MySQL 8 with InnoDB; on anything else
 * the adapter works as before and retention stays fail closed, with a warning at boot.
 */
export function createMysqlDatabase(options: MysqlDatabaseOptions): DatabaseAdapter {
  return createMysqlAdapter(options);
}

/**
 * {@link createMysqlDatabase}, for a preset: `unverifiedRetention` names a transport the lifecycle
 * was never proven on, which keeps the capability off whatever the server reports.
 */
export function createMysqlAdapter(
  options: MysqlDatabaseOptions,
  unverifiedRetention?: string,
): DatabaseAdapter {
  const { pool, owned } = resolvePool(options);
  const db = drizzle(pool as never);
  const retention: RetentionActivation = {};

  const adapter = createDrizzleMySqlAdapter(db, {
    metadata: {
      name: "MySQL",
      version: typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0",
      description: "MySQL/MariaDB database adapter (mysql2 + Drizzle)",
      kind: "mysql",
      category: "database",
    },
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- schema is AnyMySqlTable, adapter expects Table
    tables: schema as unknown as DatabaseAdapter["tables"],
    migrate: async ({ logger, release }): Promise<void> => {
      await runMigrations(async (sql) => await runRows(pool, sql), logger, release);
      await activateRetention(retentionSource(pool, unverifiedRetention), retention, logger);
    },
    close: async (): Promise<void> => {
      if (owned && pool.end) {
        await pool.end();
      }
    },
    ping: async (): Promise<void> => {
      await pool.query("SELECT 1");
    },
  });
  return attachRetention(adapter, retention);
}

/** The rows of one statement on the pool, for the migration runner. */
async function runRows(pool: PoolLike, sql: string): Promise<unknown[]> {
  const result: unknown =
    typeof pool.query === "function" ? await pool.query(sql) : await pool.execute?.(sql);
  if (!Array.isArray(result)) {
    return [];
  }
  const rows: unknown = result[0];
  return Array.isArray(rows) ? (rows as unknown[]) : [];
}
