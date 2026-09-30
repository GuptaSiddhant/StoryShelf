import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createDrizzlePgAdapter } from "./drizzle-factory-pg.ts";
import { runMigrations } from "./migrate.ts";
import { schema } from "./schema/index.ts";

declare const __PKG_VERSION__: string | undefined;

/**
 * TLS options for Postgres connections. When `true`, the driver negotiates
 * TLS with the server's default CA. When an object, `ca`/`cert`/`key` are
 * forwarded to `postgres.js` for mutual TLS (e.g. GCP Cloud SQL) or custom
 * RDS bundles.
 */
export type PostgresSslOptions = boolean | { ca?: string; cert?: string; key?: string };

/**
 * Options for creating a Postgres-backed DatabaseAdapter.
 *
 * `url` (or `connectionString`) is the Postgres connection string
 * (`postgres://user:pass@host:5432/db`). For managed providers, see the
 * deployment guide for per-provider recipes (RDS CA bundle, Cloud SQL
 * mutual TLS, Supabase pooler port `6543` with `prepare: false`, etc.).
 *
 * When `client` is supplied, all other connection options are ignored and
 * the caller owns the lifecycle of the client. This is the hook for
 * advanced setups (IAM token refresh, pre-configured TLS, etc.) and for
 * hermetic tests.
 */
export interface PostgresDatabaseOptions {
  url?: string;
  connectionString?: string;
  ssl?: PostgresSslOptions;
  prepare?: boolean;
  max?: number;
  idleTimeout?: number;
  connectTimeout?: number;
  client?: ReturnType<typeof postgres>;
}

/**
 * Create a Postgres-backed DatabaseAdapter using postgres.js and Drizzle ORM.
 *
 * Works with self-hosted Postgres, AWS RDS, GCP Cloud SQL, Supabase, Neon,
 * and Azure Database for PostgreSQL — all speak the standard wire protocol.
 * For provider-specific TLS and pooling notes, see the deployment guide.
 */
export function createPostgresDatabase(options: PostgresDatabaseOptions): DatabaseAdapter {
  const connectionString = options.connectionString ?? options.url;
  if (!options.client && !connectionString) {
    throw new Error(
      "createPostgresDatabase: provide `url` (or `connectionString`) or a preconfigured `client`",
    );
  }

  const client =
    options.client ??
    postgres(connectionString as string, {
      ssl: options.ssl as never,
      prepare: options.prepare,
      max: options.max,
      idle_timeout: options.idleTimeout,
      connect_timeout: options.connectTimeout,
    });

  // oxlint-disable-next-line typescript/no-unsafe-argument -- postgres instance may be from isolated store vs workspace
  const db = drizzle(client as never, { schema });

  return createDrizzlePgAdapter(db, {
    metadata: {
      name: "Postgres",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "Postgres database adapter (postgres.js + Drizzle)",
      kind: "postgres",
      category: "database",
    },
    tables: schema as unknown as DatabaseAdapter["tables"],
    migrate: async () => {
      await runMigrations(async (sql: string) => await client.unsafe(sql));
    },
    close: async () => {
      await client.end();
    },
    ping: async () => {
      await client.unsafe("SELECT 1");
    },
  });
}
