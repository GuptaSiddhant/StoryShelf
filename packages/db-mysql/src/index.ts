import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { createDrizzleMySqlAdapter } from "./drizzle-factory-mysql.ts";
import { runMigrations } from "./migrate.ts";
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
    return { pool: mysql.createPool(connectionString) as unknown as PoolLike, owned: true };
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
 * Create a MySQL/MariaDB-backed DatabaseAdapter using mysql2 + Drizzle.
 * Works with MySQL, MariaDB, PlanetScale (via mysql2), TiDB.
 */
export function createMysqlDatabase(options: MysqlDatabaseOptions): DatabaseAdapter {
  const { pool, owned } = resolvePool(options);
  const db = drizzle(pool as never, { schema, mode: "default" });

  return createDrizzleMySqlAdapter(db, {
    metadata: {
      name: "MySQL",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "MySQL/MariaDB database adapter (mysql2 + Drizzle)",
      kind: "mysql",
      category: "database",
    },
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- schema is AnyMySqlTable, adapter expects Table
    tables: schema as unknown as DatabaseAdapter["tables"],
    migrate: async (): Promise<void> => {
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- closes over pool from createMysqlDatabase
      const run = async (sql: string): Promise<unknown[]> => {
        if (typeof pool.query === "function") {
          await pool.query(sql);
        } else if (pool.execute) {
          await pool.execute(sql);
        }
        return [];
      };
      await runMigrations(run);
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
}
