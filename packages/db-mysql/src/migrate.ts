/**
 * Shared MySQL migrations for every `db-mysql` preset.
 *
 * MySQL 8 has no `ADD COLUMN IF NOT EXISTS`, no `CREATE INDEX IF NOT EXISTS`
 * and no `ALTER COLUMN ... DROP NOT NULL`. The DDL is split into statements,
 * missing columns/indexes are found in `information_schema`, and only a
 * duplicate-index error from a repeated DDL statement is ignored.
 */
import { DDL } from "./ddl.ts";
import { FOREIGN_KEYS, type ForeignKeyMigration } from "./foreign-keys.ts";
import { assertReviewSchema } from "./review-schema-check.ts";

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
  { table: "projects", column: "component_owners", definition: "TEXT" },
  { table: "projects", column: "run_tests", definition: "TINYINT(1) NOT NULL DEFAULT 0" },
  { table: "snapshots", column: "infra_hash", definition: "TEXT" },
  {
    table: "snapshots",
    column: "inherited",
    definition: "TINYINT(1) NOT NULL DEFAULT 0",
  },
  { table: "snapshots", column: "baseline_id", definition: "VARCHAR(64)" },
  { table: "snapshots", column: "baseline_version", definition: "TEXT" },
  { table: "snapshots", column: "source_build_id", definition: "TEXT" },
  { table: "snapshots", column: "comparison_image_path", definition: "TEXT" },
  { table: "snapshots", column: "comparison_metadata", definition: "TEXT" },
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
  { table: "snapshots", column: "unstable", definition: "TINYINT(1)" },
  { table: "projects", column: "detect_unstable", definition: "TINYINT(1) NOT NULL DEFAULT 1" },
  { table: "baselines", column: "infra_hash", definition: "TEXT" },
  { table: "baselines", column: "fingerprint", definition: "TEXT" },
  { table: "baselines", column: "source_build_id", definition: "TEXT" },
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
  { table: "builds", column: "review_cycle", definition: "INT NOT NULL DEFAULT 0" },
  { table: "builds", column: "review_requested_cycle", definition: "INT NULL" },
  { table: "builds", column: "capture_job_id", definition: "VARCHAR(26) NULL" },
  {
    table: "notification_subscriptions",
    column: "review_requests",
    definition: "BOOLEAN NOT NULL DEFAULT TRUE",
  },
  { table: "webhooks", column: "secret_encrypted", definition: "TEXT NOT NULL" },
  { table: "tokens", column: "user_id", definition: "VARCHAR(64) NULL" },
  {
    table: "project_members",
    column: "source",
    definition: "VARCHAR(32) NOT NULL DEFAULT 'manual'",
  },
  { table: "comments", column: "story_id", definition: "TEXT" },
  { table: "comments", column: "mentions", definition: "TEXT" },
  { table: "comments", column: "kind", definition: "VARCHAR(32) NOT NULL DEFAULT 'comment'" },
  { table: "comments", column: "resolved_at", definition: "DATETIME(3) NULL" },
  { table: "comments", column: "resolved_by", definition: "VARCHAR(64) NULL" },
  // Auth columns the SQLite `users` table always had (access control: `disabled`).
  { table: "users", column: "password_hash", definition: "TEXT" },
  { table: "users", column: "display_name_override", definition: "TEXT" },
  {
    table: "users",
    column: "auth_provider",
    definition: "VARCHAR(32) NOT NULL DEFAULT 'oidc'",
  },
  { table: "users", column: "disabled", definition: "TINYINT(1) NOT NULL DEFAULT 0" },
  // Single-flight jobs (ADR 0040); the unique index on active_key is in IDENTITY_INDEXES.
  { table: "capture_jobs", column: "active_key", definition: "VARCHAR(191)" },
  { table: "capture_jobs", column: "rerun_requested_at", definition: "DATETIME(3)" },
  { table: "design_nodes", column: "notified_version", definition: "TEXT" },
  { table: "notification_channels", column: "last_error", definition: "TEXT" },
  { table: "notification_channels", column: "last_error_at", definition: "DATETIME(3)" },
  { table: "notification_channels", column: "last_delivered_at", definition: "DATETIME(3)" },
];

/** A run in flight when `builds.capture_job_id` was added owns the build it was started for. */
const BUILD_CAPTURE_JOB_BACKFILL =
  "UPDATE builds SET capture_job_id = (SELECT j.job_id FROM capture_jobs j WHERE j.entry = 'job' AND j.kind = 'capture' AND j.shard_id IS NULL AND j.cancel_requested_at IS NULL AND j.status IN ('queued', 'running') AND j.build_id = builds.id LIMIT 1) WHERE capture_job_id IS NULL AND status IN ('pending', 'capturing') AND (SELECT COUNT(*) FROM capture_jobs j WHERE j.entry = 'job' AND j.kind = 'capture' AND j.shard_id IS NULL AND j.cancel_requested_at IS NULL AND j.status IN ('queued', 'running') AND j.build_id = builds.id) = 1";

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
  {
    table: "capture_jobs",
    name: "capture_jobs_active_key_idx",
    sql: "CREATE UNIQUE INDEX capture_jobs_active_key_idx ON capture_jobs (active_key)",
  },
];

/** Run the full migration set through any row-query runner. */
export async function runMigrations(run: MigrationRunner): Promise<void> {
  await assertReviewSchema(run);
  await runDdl(run);
  await ensureColumns(run);
  await run(BUILD_CAPTURE_JOB_BACKFILL);
  await migrateIndexes(run);
  await migrateLegacyColumns(run);
  await ensureForeignKeys(run);
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
  if (await indexIsUnique(run, "builds", "builds_project_gitsha_idx")) {
    await dropIndexIfExists(run, "builds", "builds_project_gitsha_idx");
  }
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

async function ensureForeignKeys(run: MigrationRunner): Promise<void> {
  for (const foreignKey of FOREIGN_KEYS) {
    // oxlint-disable-next-line no-await-in-loop -- each constraint needs its own check
    await ensureForeignKey(run, foreignKey);
  }
}

async function ensureForeignKey(
  run: MigrationRunner,
  foreignKey: ForeignKeyMigration,
): Promise<void> {
  if (await hasForeignKey(run, foreignKey)) {
    return;
  }
  await deleteOrphans(run, foreignKey);
  const table = quote(foreignKey.table);
  const column = quote(foreignKey.column);
  const parent = quote(foreignKey.parent);
  const parentColumn = quote(foreignKey.parentColumn);
  await run(
    `ALTER TABLE ${table} ADD CONSTRAINT ${foreignKey.name} FOREIGN KEY (${column}) REFERENCES ${parent}(${parentColumn}) ON DELETE CASCADE`,
  );
}

async function hasForeignKey(
  run: MigrationRunner,
  foreignKey: ForeignKeyMigration,
): Promise<boolean> {
  const rows = await run(
    `SELECT 1 FROM information_schema.key_column_usage WHERE constraint_schema = DATABASE() AND table_name = '${foreignKey.table}' AND column_name = '${foreignKey.column}' AND referenced_table_name = '${foreignKey.parent}' AND referenced_column_name = '${foreignKey.parentColumn}' LIMIT 1`,
  );
  return rows.length > 0;
}

async function deleteOrphans(run: MigrationRunner, foreignKey: ForeignKeyMigration): Promise<void> {
  const table = quote(foreignKey.table);
  const column = quote(foreignKey.column);
  const parent = quote(foreignKey.parent);
  const parentColumn = quote(foreignKey.parentColumn);
  await run(
    `DELETE FROM ${table} WHERE ${column} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${parent} WHERE ${parent}.${parentColumn} = ${table}.${column})`,
  );
}

function quote(identifier: string): string {
  return `\`${identifier}\``;
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
  try {
    await run(
      `ALTER TABLE ${migration.table} ADD COLUMN ${migration.column} ${migration.definition}`,
    );
  } catch (error) {
    // Another instance booting at the same time may have added it between the check and the ALTER.
    if (!isDuplicateColumnError(error)) {
      throw error;
    }
  }
}

function isDuplicateColumnError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  const errno = (error as { errno?: number }).errno;
  return code === "ER_DUP_FIELDNAME" || errno === 1060;
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

async function indexIsUnique(run: MigrationRunner, table: string, name: string): Promise<boolean> {
  const rows = await run(
    `SELECT NON_UNIQUE AS non_unique FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = '${table}' AND index_name = '${name}' LIMIT 1`,
  );
  const nonUnique = (rows[0] as { non_unique?: number | string } | undefined)?.non_unique;
  return nonUnique !== undefined && Number(nonUnique) === 0;
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
    "SELECT IS_NULLABLE AS is_nullable FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'comments' AND column_name = 'user_id' LIMIT 1",
  );
  const isNullable = (rows[0] as { is_nullable?: string } | undefined)?.is_nullable;
  if (isNullable !== "NO") {
    return;
  }
  await run("ALTER TABLE comments MODIFY COLUMN user_id VARCHAR(64) NULL");
}
