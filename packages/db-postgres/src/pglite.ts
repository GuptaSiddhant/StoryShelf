/**
 * PGlite (embedded Postgres/WASM) preset for the Postgres database adapter.
 *
 * Same schema, DDL, and Drizzle factory as the `postgres.js` default; only
 * the driver differs (in-memory or `memory://` WASM Postgres, no server or
 * sockets). Useful for hermetic tests and zero-infra local dev. Requires
 * the optional `@electric-sql/pglite` peer (`nub add @electric-sql/pglite`).
 */
import { PGlite } from "@electric-sql/pglite";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { drizzle } from "drizzle-orm/pglite";
import { createDrizzlePgAdapter } from "./drizzle-factory-pg.ts";
import { runMigrations } from "./migrate.ts";
import { schema } from "./schema/index.ts";

declare const __PKG_VERSION__: string | undefined;

/**
 * Options for creating a PGlite-backed DatabaseAdapter.
 *
 * When `client` (a `PGlite` instance) is supplied, `dataDir` is ignored and
 * the caller owns the lifecycle of the client (teardown is a no-op). This is
 * the hook for shared instances and for waiting on `client.waitReady` in
 * tests. With no options, an ephemeral in-memory database is created.
 */
export interface PgliteDatabaseOptions {
  dataDir?: string;
  client?: PGlite;
}

/**
 * Create a PGlite-backed DatabaseAdapter using Drizzle ORM.
 *
 * @param options - Either a `dataDir` (use `"memory://"` for an ephemeral
 * in-memory database, the default) or a preconfigured `PGlite` `client`.
 * @returns A DatabaseAdapter backed by the embedded Postgres instance.
 */
export function createPgliteDatabase(options: PgliteDatabaseOptions = {}): DatabaseAdapter {
  const owned = !options.client;
  const client = options.client ?? new PGlite(options.dataDir ?? "memory://");
  const db = drizzle(client, { schema });

  return createDrizzlePgAdapter(db, {
    metadata: {
      name: "PGlite",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "PGlite database adapter (embedded Postgres/WASM + Drizzle)",
      kind: "pglite",
      category: "database",
    },
    tables: schema,
    migrate: async () => {
      await runMigrations(async (sql) => {
        const result = await client.query(sql);
        // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- PGlite Row[] vs unknown[]
        return result.rows as unknown as unknown[];
      });
    },
    close: async () => {
      if (owned) {
        await client.close();
      }
    },
    ping: async () => {
      await client.query("SELECT 1");
    },
  });
}
