/**
 * Shared Postgres migrations for every `db-postgres` preset.
 *
 * The DDL plus idempotent follow-up ALTERs run through a minimal row-query
 * runner so all drivers (`postgres.js`, `node-postgres`, Neon, …) share one
 * migration path instead of drifting per preset.
 */
import { DDL } from "./ddl.ts";

/** Minimal row-query surface a migration runner needs. */
export type MigrationRunner = (sql: string) => Promise<unknown[]>;

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
const SNAPSHOT_INHERITED_ALTER =
  "ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS inherited BOOLEAN NOT NULL DEFAULT false";
const SNAPSHOT_BASELINE_ID_ALTER =
  "ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS baseline_id TEXT";
const SNAPSHOT_BASELINE_VERSION_ALTER =
  "ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS baseline_version TEXT";
const BASELINE_INFRA_HASH_ALTER = "ALTER TABLE baselines ADD COLUMN IF NOT EXISTS infra_hash TEXT";
const BUILD_AFFECTED_ONLY_ALTER =
  "ALTER TABLE builds ADD COLUMN IF NOT EXISTS affected_only BOOLEAN NOT NULL DEFAULT true";
const BUILD_BASELINE_SHA_ALTER = "ALTER TABLE builds ADD COLUMN IF NOT EXISTS baseline_sha TEXT";
const BUILD_CHANGED_FILES_ALTER = "ALTER TABLE builds ADD COLUMN IF NOT EXISTS changed_files TEXT";
const BUILD_AFFECTED_PATHS_ALTER =
  "ALTER TABLE builds ADD COLUMN IF NOT EXISTS affected_import_paths TEXT";
const WEBHOOK_SECRET_ALTER =
  "ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS secret_encrypted TEXT NOT NULL DEFAULT ''";
const WEBHOOK_SECRET_DROP = "ALTER TABLE webhooks DROP COLUMN IF EXISTS secret";
const TOKEN_USER_ALTER =
  "ALTER TABLE tokens ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE";
const MEMBER_SOURCE_ALTER =
  "ALTER TABLE project_members ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'";
/**
 * Re-runs share `(project_id, git_sha)` by design (ULID build ids), so the
 * lookup index must not be unique. Existing databases created it UNIQUE —
 * drop (MySQL syntax, no IF EXISTS) and recreate it plain.
 */
const BUILDS_GITSHA_DEDUP = "DROP INDEX builds_project_gitsha_idx ON builds";
const BUILDS_GITSHA_INDEX =
  "CREATE INDEX builds_project_gitsha_idx ON builds (project_id, git_sha)";

async function migrateSnapshotColumns(run: MigrationRunner): Promise<void> {
  await execIgnore(run, SNAPSHOT_INFRA_HASH_ALTER);
  await execIgnore(run, SNAPSHOT_INHERITED_ALTER);
  await execIgnore(run, SNAPSHOT_BASELINE_ID_ALTER);
  await execIgnore(run, SNAPSHOT_BASELINE_VERSION_ALTER);
}

async function migrateProjectExtras(run: MigrationRunner): Promise<void> {
  await execIgnore(run, EXECUTE_PLAY_ALTER);
  await execIgnore(run, PLAY_TIMEOUT_MS_ALTER);
  await execIgnore(run, PROJECT_AUTOMIGRATE_ALTER);
  await migrateSnapshotColumns(run);
  await execIgnore(run, BASELINE_INFRA_HASH_ALTER);
  await execIgnore(run, BUILD_AFFECTED_ONLY_ALTER);
  await execIgnore(run, BUILD_BASELINE_SHA_ALTER);
  await execIgnore(run, BUILD_CHANGED_FILES_ALTER);
  await execIgnore(run, BUILD_AFFECTED_PATHS_ALTER);
}

/** Run the full migration set through any row-query runner. */
export async function runMigrations(run: MigrationRunner): Promise<void> {
  await run(DDL);
  await migrateCoreColumns(run);
  await migrateProjectExtras(run);
  await migrateCommentsTable(run);
}

async function migrateCoreColumns(run: MigrationRunner): Promise<void> {
  await execIgnore(run, STORYBOOK_META_ALTER);
  await execIgnore(run, RUN_A11Y_ALTER);
  await execIgnore(run, PROJECT_BROWSER_ALTER);
  await execIgnore(run, PROJECT_VIEWPORTS_ALTER);
  await execIgnore(run, WEBHOOK_SECRET_ALTER);
  await execIgnore(run, WEBHOOK_SECRET_DROP);
  await execIgnore(run, TOKEN_USER_ALTER);
  await execIgnore(run, MEMBER_SOURCE_ALTER);
  await execIgnore(run, BUILDS_GITSHA_DEDUP);
  await execIgnore(run, BUILDS_GITSHA_INDEX);
}

async function execIgnore(run: MigrationRunner, sql: string): Promise<void> {
  try {
    await run(sql);
  } catch {
    // idempotent — already migrated
  }
}

async function migrateCommentsTable(run: MigrationRunner): Promise<void> {
  try {
    const rows = (await run(
      "SELECT is_nullable FROM information_schema.columns WHERE table_name='comments' AND column_name='user_id'",
    )) as { is_nullable: string }[];
    const isNullable = rows[0]?.is_nullable;
    if (isNullable === "YES" || isNullable === undefined) {
      return;
    }
    await run("ALTER TABLE comments ALTER COLUMN user_id DROP NOT NULL");
  } catch {
    // already nullable or table missing — ignore
  }
}
