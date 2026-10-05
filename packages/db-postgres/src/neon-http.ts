/**
 * Neon HTTP preset for the Postgres database adapter.
 *
 * Same schema, DDL, and Drizzle factory as the `postgres.js` default, but
 * over Neon's fetch-based HTTP driver — no sockets, so it runs in hard
 * serverless and edge runtimes (Cloudflare Workers, Vercel Edge) where
 * WebSockets are unavailable. Requires the optional
 * `@neondatabase/serverless` peer (`nub add @neondatabase/serverless`).
 *
 * Note: HTTP has no interactive transactions; drizzle emulates `transact`
 * sequentially per call. Concurrent writers should prefer `./neon`.
 */
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { drizzle } from "drizzle-orm/neon-http";
import { createDrizzlePgAdapter } from "./drizzle-factory-pg.ts";
import { runMigrations } from "./migrate.ts";
import { schema } from "./schema/index.ts";

declare const __PKG_VERSION__: string | undefined;

/**
 * Options for creating a Neon-HTTP-backed DatabaseAdapter.
 *
 * When `client` (a `neon()` query function) is supplied, `url` is ignored
 * and the caller owns the lifecycle of the client (teardown is a no-op).
 */
export interface NeonHttpDatabaseOptions {
  url?: string;
  connectionString?: string;
  client?: NeonQueryFunction<false, false>;
}

/**
 * Create a Neon-HTTP-backed DatabaseAdapter using Drizzle ORM.
 *
 * @param options - Either a connection `url` or a preconfigured `neon()`
 * query function.
 * @returns A DatabaseAdapter backed by the Neon database.
 */
export function createNeonHttpDatabase(options: NeonHttpDatabaseOptions): DatabaseAdapter {
  const { sql } = resolveClient(options);
  const db = drizzle(sql, { schema });

  return createDrizzlePgAdapter(db, {
    metadata: {
      name: "Neon HTTP",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "Neon Postgres database adapter (HTTP driver + Drizzle)",
      kind: "neon-http",
      category: "database",
    },
    tables: schema,
    migrate: async () => {
      await runMigrations(async (statement) => await sql.query(statement));
    },
    close: () => {
      // no-op: fetch-based queries hold no connections (owned or not)
    },
    ping: async () => {
      await sql.query("SELECT 1");
    },
  });
}

/** Resolve the query function, distinguishing caller-owned from owned. */
function resolveClient(options: NeonHttpDatabaseOptions): {
  sql: NeonQueryFunction<false, false>;
  owned: boolean;
} {
  if (options.client) {
    return { sql: options.client, owned: false };
  }
  const connectionString = options.connectionString ?? options.url;
  if (!connectionString) {
    throw new Error(
      "createNeonHttpDatabase: provide `url` (or `connectionString`) or a preconfigured `client`",
    );
  }
  return { sql: neon(connectionString), owned: true };
}
