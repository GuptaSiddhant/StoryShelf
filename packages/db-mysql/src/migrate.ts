/**
 * Shared MySQL migrations for every `db-mysql` preset.
 *
 * MySQL 8 has no `ADD COLUMN IF NOT EXISTS`, no `CREATE INDEX IF NOT EXISTS`
 * and no `ALTER COLUMN ... DROP NOT NULL`. The DDL is split into statements,
 * missing columns/indexes are found in `information_schema`, and only a
 * duplicate-index error from a repeated DDL statement is ignored.
 */
import { DDL } from "./ddl.ts";

/** Minimal row-query surface a migration runner needs. */
export type MigrationRunner = (sql: string) => Promise<unknown[]>;

interface ColumnMigration {
  table: string;
  column: string;
  definition: string;
}

const COLUMN_MIGRATIONS: ColumnMigration[] = [
  { table: "projects", column: "storybook_meta", definition: "TEXT" },
  {
    table: "projects",
    column: "execute_play",
    definition: "TINYINT(1) NOT NULL DEFAULT 0",
  },
  {
    table: "projects",
    column: "play_timeout_ms",
    definition: "INTEGER NOT NULL DEFAULT 10000",
  },
  { table: "projects", column: "run_a11y", definition: "TINYINT(1) NOT NULL DEFAULT 1" },
  {
    table: "projects",
    column: "browser",
    definition: "VARCHAR(64) NOT NULL DEFAULT 'chromium'",
  },
  { table: "projects", column: "viewports", definition: "TEXT" },
  { table: "projects", column: "browsers", definition: "TEXT" },
  { table: "projects", column: "modes_allowlist", definition: "TEXT" },
  { table: "projects", column: "automigrate", definition: "TINYINT(1) NOT NULL DEFAULT 0" },
  { table: "projects", column: "ai_profile", definition: "TEXT" },
  {
    table: "projects",
    column: "review_enabled",
    definition: "TINYINT(1) NOT NULL DEFAULT 1",
  },
  { table: "projects", column: "review_approvals", definition: "INT NOT NULL DEFAULT 1" },
  { table: "projects", column: "storybook_url_ttl_seconds", definition: "INT" },
  { table: "projects", column: "run_tests", definition: "TINYINT(1) NOT NULL DEFAULT 0" },
  { table: "snapshots", column: "infra_hash", definition: "TEXT" },
  {
    table: "snapshots",
    column: "inherited",
    definition: "TINYINT(1) NOT NULL DEFAULT 0",
  },
  { table: "snapshots", column: "baseline_id", definition: "VARCHAR(64)" },
  { table: "snapshots", column: "baseline_version", definition: "TEXT" },
  { table: "snapshots", column: "design_url", definition: "TEXT" },
  { table: "snapshots", column: "env_change", definition: "TEXT" },
  { table: "snapshots", column: "mode", definition: "VARCHAR(64)" },
  {
    table: "snapshots",
    column: "browser",
    definition: "VARCHAR(64) NOT NULL DEFAULT 'chromium'",
  },
  { table: "snapshots", column: "duration_ms", definition: "INT" },
  { table: "snapshots", column: "a11y_violations", definition: "TEXT" },
  { table: "baselines", column: "infra_hash", definition: "TEXT" },
  { table: "baselines", column: "fingerprint", definition: "TEXT" },
  { table: "baselines", column: "mode", definition: "VARCHAR(64)" },
  {
    table: "baselines",
    column: "browser",
    definition: "VARCHAR(64) NOT NULL DEFAULT 'chromium'",
  },
  {
    table: "builds",
    column: "affected_only",
    definition: "TINYINT(1) NOT NULL DEFAULT 1",
  },
  { table: "builds", column: "baseline_sha", definition: "TEXT" },
  { table: "builds", column: "changed_files", definition: "TEXT" },
  { table: "builds", column: "affected_import_paths", definition: "TEXT" },
  { table: "builds", column: "inherited_count", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "builds", column: "test_results", definition: "TEXT" },
  { table: "webhooks", column: "secret_encrypted", definition: "TEXT NOT NULL" },
  { table: "tokens", column: "user_id", definition: "VARCHAR(64) NULL" },
  {
    table: "project_members",
    column: "source",
    definition: "VARCHAR(32) NOT NULL DEFAULT 'manual'",
  },
  { table: "comments", column: "story_id", definition: "TEXT" },
  { table: "notification_channels", column: "last_error", definition: "TEXT" },
  { table: "notification_channels", column: "last_error_at", definition: "DATETIME(3)" },
];

const IDENTITY_INDEXES = [
  {
    table: "snapshots",
    name: "snapshots_build_story_mode_browser_idx",
    sql: "CREATE UNIQUE INDEX snapshots_build_story_mode_browser_idx ON snapshots (build_id, story_id, viewport_name, browser)",
  },
  {
    table: "baselines",
    name: "baselines_project_story_mode_browser_branch_idx",
    sql: "CREATE UNIQUE INDEX baselines_project_story_mode_browser_branch_idx ON baselines (project_id, story_id, viewport_name, browser, branch)",
  },
];

/** Run the full migration set through any row-query runner. */
export async function runMigrations(run: MigrationRunner): Promise<void> {
  await runDdl(run);
  await ensureColumns(run);
  await migrateIndexes(run);
  await migrateLegacyColumns(run);
}

async function ensureColumns(run: MigrationRunner): Promise<void> {
  for (const migration of COLUMN_MIGRATIONS) {
    // oxlint-disable-next-line no-await-in-loop -- information_schema query then ALTER
    await ensureColumn(run, migration);
  }
}

async function migrateIndexes(run: MigrationRunner): Promise<void> {
  await dropIndexIfExists(run, "snapshots", "snapshots_build_story_viewport_idx");
  await dropIndexIfExists(run, "baselines", "baselines_project_story_viewport_branch_idx");
  for (const index of IDENTITY_INDEXES) {
    // oxlint-disable-next-line no-await-in-loop -- index creation follows the legacy drops
    await ensureIndex(run, index.table, index.name, index.sql);
  }
  await dropIndexIfExists(run, "builds", "builds_project_gitsha_idx");
  await ensureIndex(
    run,
    "builds",
    "builds_project_gitsha_idx",
    "CREATE INDEX builds_project_gitsha_idx ON builds (project_id, git_sha)",
  );
  await ensureIndex(
    run,
    "design_links",
    "design_links_project_import_path_idx",
    "CREATE UNIQUE INDEX design_links_project_import_path_idx ON design_links (project_id, import_path)",
  );
}

async function migrateLegacyColumns(run: MigrationRunner): Promise<void> {
  await dropColumnIfExists(run, "webhooks", "secret");
  await migrateCommentsTable(run);
}

async function runDdl(run: MigrationRunner): Promise<void> {
  for (const statement of splitStatements(DDL)) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- DDL order matters
      await run(statement);
    } catch (error) {
      if (!isDuplicateIndexError(error)) {
        throw error;
      }
    }
  }
}

function splitStatements(ddl: string): string[] {
  return ddl
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function isDuplicateIndexError(error: unknown): boolean {
  const code = (error as { code?: string; errno?: number }).code;
  const errno = (error as { errno?: number }).errno;
  return code === "ER_DUP_KEYNAME" || errno === 1061;
}

async function ensureColumn(run: MigrationRunner, migration: ColumnMigration): Promise<void> {
  if (await hasColumn(run, migration.table, migration.column)) {
    return;
  }
  await run(
    `ALTER TABLE ${migration.table} ADD COLUMN ${migration.column} ${migration.definition}`,
  );
}

async function hasColumn(run: MigrationRunner, table: string, column: string): Promise<boolean> {
  const rows = await run(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${table}' AND column_name = '${column}' LIMIT 1`,
  );
  return rows.length > 0;
}

async function ensureIndex(
  run: MigrationRunner,
  table: string,
  name: string,
  sql: string,
): Promise<void> {
  if (await hasIndex(run, table, name)) {
    return;
  }
  await run(sql);
}

async function hasIndex(run: MigrationRunner, table: string, name: string): Promise<boolean> {
  const rows = await run(
    `SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = '${table}' AND index_name = '${name}' LIMIT 1`,
  );
  return rows.length > 0;
}

async function dropIndexIfExists(run: MigrationRunner, table: string, name: string): Promise<void> {
  if (await hasIndex(run, table, name)) {
    await run(`ALTER TABLE ${table} DROP INDEX ${name}`);
  }
}

async function dropColumnIfExists(
  run: MigrationRunner,
  table: string,
  column: string,
): Promise<void> {
  if (await hasColumn(run, table, column)) {
    await run(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
}

async function migrateCommentsTable(run: MigrationRunner): Promise<void> {
  const rows = await run(
    "SELECT is_nullable FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'comments' AND column_name = 'user_id' LIMIT 1",
  );
  const isNullable = (rows[0] as { is_nullable?: string } | undefined)?.is_nullable;
  if (isNullable !== "NO") {
    return;
  }
  await run("ALTER TABLE comments MODIFY COLUMN user_id VARCHAR(64) NULL");
}
