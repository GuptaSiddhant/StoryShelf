/** Dedicated-connection sessions for `runMigrationsLocked`, shared by the `pg` and Neon presets. */
import type { MigrationSession } from "./migrate.ts";

/** A connection that answers `query` with rows (node-postgres and the Neon driver both do). */
interface Connection {
  query(sql: string): Promise<{ rows: unknown[] }>;
}

/** A pool that hands out a connection to give back with `release`. */
interface ConnectionPool {
  connect(): Promise<Connection & { release(): void }>;
}

/** Check out one connection for the whole migration, so the advisory lock and the DDL share a session. */
export function pooledSession(pool: ConnectionPool): MigrationSession {
  return async (use) => {
    const connection = await pool.connect();
    try {
      return await use(async (sql) => (await connection.query(sql)).rows);
    } finally {
      connection.release();
    }
  };
}

/** An injected single `Client` or `PoolClient` is already one session. */
export function singleSession(connection: Connection): MigrationSession {
  return async (use) => await use(async (sql) => (await connection.query(sql)).rows);
}
