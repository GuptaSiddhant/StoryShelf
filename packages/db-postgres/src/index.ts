import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createDrizzlePgAdapter } from "@storyshelf/core/adapter/database";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { DDL } from "./ddl.ts";
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
    migrate: async () => {
      await runMigrations(client);
    },
    close: async () => {
      await client.end();
    },
    ping: async () => {
      await client.unsafe("SELECT 1");
    },
  });
}

const STORYBOOK_META_ALTER = "ALTER TABLE projects ADD COLUMN IF NOT EXISTS storybook_meta TEXT";
const EXECUTE_PLAY_ALTER =
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS execute_play BOOLEAN NOT NULL DEFAULT false";
const PLAY_TIMEOUT_MS_ALTER =
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS play_timeout_ms INTEGER NOT NULL DEFAULT 10000";
const RUN_A11Y_ALTER =
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS run_a11y BOOLEAN NOT NULL DEFAULT false";
const PROJECT_BROWSER_ALTER =
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS browser TEXT NOT NULL DEFAULT 'chromium'";
const PROJECT_VIEWPORTS_ALTER = "ALTER TABLE projects ADD COLUMN IF NOT EXISTS viewports TEXT";
const PROJECT_AUTOMIGRATE_ALTER =
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS automigrate BOOLEAN NOT NULL DEFAULT false";
const SNAPSHOT_INFRA_HASH_ALTER = "ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS infra_hash TEXT";
const BASELINE_INFRA_HASH_ALTER = "ALTER TABLE baselines ADD COLUMN IF NOT EXISTS infra_hash TEXT";
const WEBHOOK_SECRET_ALTER =
  "ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS secret_encrypted TEXT NOT NULL DEFAULT ''";
const WEBHOOK_SECRET_DROP = "ALTER TABLE webhooks DROP COLUMN IF EXISTS secret";
const TOKEN_USER_ALTER =
  "ALTER TABLE tokens ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE";
const MEMBER_SOURCE_ALTER =
  "ALTER TABLE project_members ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'";

async function migrateProjectExtras(client: ReturnType<typeof postgres>): Promise<void> {
  await execIgnore(client, EXECUTE_PLAY_ALTER);
  await execIgnore(client, PLAY_TIMEOUT_MS_ALTER);
  await execIgnore(client, PROJECT_AUTOMIGRATE_ALTER);
  await execIgnore(client, SNAPSHOT_INFRA_HASH_ALTER);
  await execIgnore(client, BASELINE_INFRA_HASH_ALTER);
}

async function runMigrations(client: ReturnType<typeof postgres>): Promise<void> {
  await client.unsafe(DDL);
  await execIgnore(client, STORYBOOK_META_ALTER);
  await execIgnore(client, RUN_A11Y_ALTER);
  await execIgnore(client, PROJECT_BROWSER_ALTER);
  await execIgnore(client, PROJECT_VIEWPORTS_ALTER);
  await migrateProjectExtras(client);
  await execIgnore(client, WEBHOOK_SECRET_ALTER);
  await execIgnore(client, WEBHOOK_SECRET_DROP);
  await execIgnore(client, TOKEN_USER_ALTER);
  await execIgnore(client, MEMBER_SOURCE_ALTER);
  await migrateCommentsTable(client);
}

async function execIgnore(client: ReturnType<typeof postgres>, sql: string): Promise<void> {
  try {
    await client.unsafe(sql);
  } catch {
    // idempotent — already migrated
  }
}

async function migrateCommentsTable(client: ReturnType<typeof postgres>): Promise<void> {
  try {
    const rows = (await client.unsafe(
      "SELECT is_nullable FROM information_schema.columns WHERE table_name='comments' AND column_name='user_id'",
    )) as unknown as { is_nullable: string }[];
    const isNullable = rows[0]?.is_nullable;
    if (isNullable === "YES" || isNullable === undefined) {
      return;
    }
    await client.unsafe("ALTER TABLE comments ALTER COLUMN user_id DROP NOT NULL");
  } catch {
    // already nullable or table missing — ignore
  }
}
