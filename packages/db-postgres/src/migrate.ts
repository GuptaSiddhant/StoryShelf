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
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS run_a11y BOOLEAN NOT NULL DEFAULT true";
const RUN_A11Y_DEFAULT_ALTER = "ALTER TABLE projects ALTER COLUMN run_a11y SET DEFAULT true";
const PROJECT_BROWSER_ALTER =
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS browser TEXT NOT NULL DEFAULT 'chromium'";
const PROJECT_VIEWPORTS_ALTER = "ALTER TABLE projects ADD COLUMN IF NOT EXISTS viewports TEXT";
const PROJECT_AUTOMIGRATE_ALTER =
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS automigrate BOOLEAN NOT NULL DEFAULT false";
const PROJECT_AI_PROFILE_ALTER = "ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_profile TEXT";
const PROJECT_REVIEW_ENABLED_ALTER =
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS review_enabled BOOLEAN NOT NULL DEFAULT true";
const PROJECT_REVIEW_APPROVALS_ALTER =
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS review_approvals INTEGER NOT NULL DEFAULT 1";
const PROJECT_STORYBOOK_URL_TTL_ALTER =
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS storybook_url_ttl_seconds INTEGER";
const SNAPSHOT_INFRA_HASH_ALTER = "ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS infra_hash TEXT";
const SNAPSHOT_INHERITED_ALTER =
  "ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS inherited BOOLEAN NOT NULL DEFAULT false";
const SNAPSHOT_BASELINE_ID_ALTER =
  "ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS baseline_id TEXT";
const SNAPSHOT_BASELINE_VERSION_ALTER =
  "ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS baseline_version TEXT";
const SNAPSHOT_COMPARISON_IMAGE_ALTER =
  "ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS comparison_image_path TEXT";
const SNAPSHOT_COMPARISON_METADATA_ALTER =
  "ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS comparison_metadata TEXT";
const SNAPSHOT_SOURCE_BUILD_ALTER =
  "ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS source_build_id TEXT";
const BASELINE_SOURCE_BUILD_ALTER =
  "ALTER TABLE baselines ADD COLUMN IF NOT EXISTS source_build_id TEXT";
const SNAPSHOT_ENV_CHANGE_ALTER = "ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS env_change TEXT";
const SNAPSHOT_DESIGN_URL_ALTER = "ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS design_url TEXT";
const SNAPSHOT_DURATION_ALTER =
  "ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS duration_ms INTEGER";
const SNAPSHOT_A11Y_ALTER = "ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS a11y_violations TEXT";
const DESIGN_LINKS_UNIQUE_INDEX =
  "CREATE UNIQUE INDEX IF NOT EXISTS design_links_project_import_path_idx ON design_links (project_id, import_path)";
/** Pre-adapter Figma tables (replaced by design_nodes / design_credentials; no data is carried over). */
const LEGACY_DESIGN_DROPS = [
  "DROP TABLE IF EXISTS figma_nodes",
  "DROP TABLE IF EXISTS design_tokens",
];
const BASELINE_FINGERPRINT_ALTER =
  "ALTER TABLE baselines ADD COLUMN IF NOT EXISTS fingerprint TEXT";
const BASELINE_INFRA_HASH_ALTER = "ALTER TABLE baselines ADD COLUMN IF NOT EXISTS infra_hash TEXT";
const BUILD_AFFECTED_ONLY_ALTER =
  "ALTER TABLE builds ADD COLUMN IF NOT EXISTS affected_only BOOLEAN NOT NULL DEFAULT true";
const BUILD_BASELINE_SHA_ALTER = "ALTER TABLE builds ADD COLUMN IF NOT EXISTS baseline_sha TEXT";
const BUILD_CHANGED_FILES_ALTER = "ALTER TABLE builds ADD COLUMN IF NOT EXISTS changed_files TEXT";
const BUILD_AFFECTED_PATHS_ALTER =
  "ALTER TABLE builds ADD COLUMN IF NOT EXISTS affected_import_paths TEXT";
const BUILD_INHERITED_COUNT_ALTER =
  "ALTER TABLE builds ADD COLUMN IF NOT EXISTS inherited_count INTEGER NOT NULL DEFAULT 0";
const BUILD_TEST_RESULTS_ALTER = "ALTER TABLE builds ADD COLUMN IF NOT EXISTS test_results TEXT";
const BUILD_CAPTURE_JOB_ALTER = "ALTER TABLE builds ADD COLUMN IF NOT EXISTS capture_job_id TEXT";
/** A run in flight when the column was added owns the build it was started for (idempotent). */
const BUILD_CAPTURE_JOB_BACKFILL =
  "UPDATE builds SET capture_job_id = (SELECT j.job_id FROM capture_jobs j WHERE j.entry = 'job' AND j.kind = 'capture' AND j.shard_id IS NULL AND j.cancel_requested_at IS NULL AND j.status IN ('queued', 'running') AND j.build_id = builds.id ORDER BY j.created_at DESC LIMIT 1) WHERE capture_job_id IS NULL AND status IN ('pending', 'capturing') AND (SELECT COUNT(*) FROM capture_jobs j WHERE j.entry = 'job' AND j.kind = 'capture' AND j.shard_id IS NULL AND j.cancel_requested_at IS NULL AND j.status IN ('queued', 'running') AND j.build_id = builds.id AND j.created_at = (SELECT MAX(k.created_at) FROM capture_jobs k WHERE k.entry = 'job' AND k.kind = 'capture' AND k.shard_id IS NULL AND k.cancel_requested_at IS NULL AND k.status IN ('queued', 'running') AND k.build_id = builds.id)) <= 1";
const RUN_TESTS_ALTER =
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS run_tests BOOLEAN NOT NULL DEFAULT false";
const WEBHOOK_SECRET_ALTER =
  "ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS secret_encrypted TEXT NOT NULL DEFAULT ''";
const WEBHOOK_SECRET_DROP = "ALTER TABLE webhooks DROP COLUMN IF EXISTS secret";
const TOKEN_USER_ALTER =
  "ALTER TABLE tokens ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE";
const MEMBER_SOURCE_ALTER =
  "ALTER TABLE project_members ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'";
/**
 * Auth columns the SQLite `users` table always had. Without them the Drizzle model cannot store
 * `disabled` (an admin disabling a user fails) or the auth provider and display-name override.
 */
const USER_AUTH_ALTERS = [
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name_override TEXT",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'oidc'",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT false",
];
const COMMENT_STORY_ID_ALTER = "ALTER TABLE comments ADD COLUMN IF NOT EXISTS story_id TEXT";
const NOTIFICATION_LAST_ERROR_ALTER =
  "ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS last_error TEXT";
const NOTIFICATION_LAST_ERROR_AT_ALTER =
  "ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ";
/**
 * Re-runs share `(project_id, git_sha)` by design (ULID build ids), so the
 * lookup index must not be unique. Existing databases created it UNIQUE —
 * drop and recreate it plain.
 */
const BUILDS_GITSHA_DEDUP = "DROP INDEX IF EXISTS builds_project_gitsha_idx";
const BUILDS_GITSHA_INDEX =
  "CREATE INDEX IF NOT EXISTS builds_project_gitsha_idx ON builds (project_id, git_sha)";

const PROJECT_BROWSERS_ALTER = "ALTER TABLE projects ADD COLUMN IF NOT EXISTS browsers TEXT";
const PROJECT_MODES_ALLOWLIST_ALTER =
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS modes_allowlist TEXT";
const SNAPSHOT_MODE_ALTER = "ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS mode TEXT";
const SNAPSHOT_BROWSER_ALTER =
  "ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS browser TEXT NOT NULL DEFAULT 'chromium'";
const BASELINE_MODE_ALTER = "ALTER TABLE baselines ADD COLUMN IF NOT EXISTS mode TEXT";
const BASELINE_BROWSER_ALTER =
  "ALTER TABLE baselines ADD COLUMN IF NOT EXISTS browser TEXT NOT NULL DEFAULT 'chromium'";
/** Swap the viewport-only unique indexes for the browser-aware ones (rows default to chromium). */
const IDENTITY_STATEMENTS = [
  "DROP INDEX IF EXISTS snapshots_build_story_viewport_idx",
  "DROP INDEX IF EXISTS baselines_project_story_viewport_branch_idx",
  "CREATE UNIQUE INDEX IF NOT EXISTS snapshots_build_story_mode_browser_idx ON snapshots (build_id, story_id, viewport_name, browser)",
  "CREATE UNIQUE INDEX IF NOT EXISTS baselines_project_story_mode_browser_branch_idx ON baselines (project_id, story_id, viewport_name, browser, branch)",
];

async function migrateSnapshotColumns(run: MigrationRunner): Promise<void> {
  await execIgnore(run, SNAPSHOT_INFRA_HASH_ALTER);
  await execIgnore(run, SNAPSHOT_INHERITED_ALTER);
  await execIgnore(run, SNAPSHOT_BASELINE_ID_ALTER);
  await execIgnore(run, SNAPSHOT_BASELINE_VERSION_ALTER);
  await migrateComparisonColumns(run);
  await execIgnore(run, SNAPSHOT_DESIGN_URL_ALTER);
  await execIgnore(run, SNAPSHOT_ENV_CHANGE_ALTER);
  await execIgnore(run, SNAPSHOT_DURATION_ALTER);
  await execIgnore(run, SNAPSHOT_A11Y_ALTER);
  await migrateCaptureIdentityColumns(run);
}

async function migrateComparisonColumns(run: MigrationRunner): Promise<void> {
  await execIgnore(run, SNAPSHOT_SOURCE_BUILD_ALTER);
  await execIgnore(run, SNAPSHOT_COMPARISON_IMAGE_ALTER);
  await execIgnore(run, SNAPSHOT_COMPARISON_METADATA_ALTER);
}

async function migrateCaptureIdentityColumns(run: MigrationRunner): Promise<void> {
  await execIgnore(run, SNAPSHOT_MODE_ALTER);
  await execIgnore(run, SNAPSHOT_BROWSER_ALTER);
  await execIgnore(run, BASELINE_MODE_ALTER);
  await execIgnore(run, BASELINE_BROWSER_ALTER);
  await execIgnore(run, PROJECT_BROWSERS_ALTER);
  await execIgnore(run, PROJECT_MODES_ALLOWLIST_ALTER);
  await execIgnore(run, DESIGN_LINKS_UNIQUE_INDEX);
  await Promise.all(
    LEGACY_DESIGN_DROPS.map(async (statement) => {
      await execIgnore(run, statement);
    }),
  );
}

async function migrateBaselineColumns(run: MigrationRunner): Promise<void> {
  await execIgnore(run, BASELINE_INFRA_HASH_ALTER);
  await execIgnore(run, BASELINE_FINGERPRINT_ALTER);
  await execIgnore(run, BASELINE_SOURCE_BUILD_ALTER);
}

async function migrateProjectExtras(run: MigrationRunner): Promise<void> {
  await execIgnore(run, EXECUTE_PLAY_ALTER);
  await execIgnore(run, PLAY_TIMEOUT_MS_ALTER);
  await execIgnore(run, PROJECT_AUTOMIGRATE_ALTER);
  await execIgnore(run, PROJECT_AI_PROFILE_ALTER);
  await migrateProjectReviewColumns(run);
  await migrateSnapshotColumns(run);
  await migrateBaselineColumns(run);
  await migrateBuildColumns(run);
  await execIgnore(run, RUN_TESTS_ALTER);
}

async function migrateProjectReviewColumns(run: MigrationRunner): Promise<void> {
  await execIgnore(run, PROJECT_REVIEW_ENABLED_ALTER);
  await execIgnore(run, PROJECT_REVIEW_APPROVALS_ALTER);
  await execIgnore(run, PROJECT_STORYBOOK_URL_TTL_ALTER);
}

async function migrateBuildColumns(run: MigrationRunner): Promise<void> {
  await execIgnore(run, BUILD_AFFECTED_ONLY_ALTER);
  await execIgnore(run, BUILD_BASELINE_SHA_ALTER);
  await execIgnore(run, BUILD_CHANGED_FILES_ALTER);
  await execIgnore(run, BUILD_AFFECTED_PATHS_ALTER);
  await execIgnore(run, BUILD_INHERITED_COUNT_ALTER);
  await execIgnore(run, BUILD_TEST_RESULTS_ALTER);
  await execIgnore(run, BUILD_CAPTURE_JOB_ALTER);
}

/** Run the full migration set through any row-query runner. */
export async function runMigrations(run: MigrationRunner): Promise<void> {
  await run(DDL);
  await migrateCoreColumns(run);
  await migrateUserAuthColumns(run);
  await migrateProjectExtras(run);
  // Not swallowed: an unfenced build would let a late crash hook fail a newer run.
  await run(BUILD_CAPTURE_JOB_BACKFILL);
  await applyIdentityStatements(run);
  await migrateCommentsTable(run);
  await migrateNotificationColumns(run);
}

/**
 * Unlike the other follow-up ALTERs this one is not swallowed: if the columns cannot be added the
 * boot must fail loudly, because a missing `disabled` column means access control silently does
 * not work. `ADD COLUMN IF NOT EXISTS` is already idempotent, so there is no "already done" error
 * to ignore.
 */
async function migrateUserAuthColumns(run: MigrationRunner): Promise<void> {
  for (const statement of USER_AUTH_ALTERS) {
    // oxlint-disable-next-line no-await-in-loop -- ordered, and a failure must stop the boot
    await run(statement);
  }
}

async function migrateRunA11yDefault(run: MigrationRunner): Promise<void> {
  await execIgnore(run, RUN_A11Y_ALTER);
  await execIgnore(run, RUN_A11Y_DEFAULT_ALTER);
}

async function migrateCoreColumns(run: MigrationRunner): Promise<void> {
  await execIgnore(run, STORYBOOK_META_ALTER);
  await migrateRunA11yDefault(run);
  await execIgnore(run, PROJECT_BROWSER_ALTER);
  await execIgnore(run, PROJECT_VIEWPORTS_ALTER);
  await execIgnore(run, WEBHOOK_SECRET_ALTER);
  await execIgnore(run, WEBHOOK_SECRET_DROP);
  await execIgnore(run, TOKEN_USER_ALTER);
  await execIgnore(run, MEMBER_SOURCE_ALTER);
  await execIgnore(run, BUILDS_GITSHA_DEDUP);
  await execIgnore(run, BUILDS_GITSHA_INDEX);
}

async function applyIdentityStatements(run: MigrationRunner): Promise<void> {
  for (const statement of IDENTITY_STATEMENTS) {
    // oxlint-disable-next-line no-await-in-loop -- ordered: drop old indexes, then create new
    await execIgnore(run, statement);
  }
}

async function execIgnore(run: MigrationRunner, sql: string): Promise<void> {
  try {
    await run(sql);
  } catch {
    // idempotent — already migrated
  }
}

async function migrateNotificationColumns(run: MigrationRunner): Promise<void> {
  await execIgnore(run, NOTIFICATION_LAST_ERROR_ALTER);
  await execIgnore(run, NOTIFICATION_LAST_ERROR_AT_ALTER);
}

async function migrateCommentsTable(run: MigrationRunner): Promise<void> {
  await execIgnore(run, COMMENT_STORY_ID_ALTER);
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
