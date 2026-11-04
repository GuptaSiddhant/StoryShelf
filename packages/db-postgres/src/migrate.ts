/**
 * Shared Postgres migrations for every `db-postgres` preset.
 *
 * The DDL plus idempotent follow-up ALTERs run through a minimal row-query
 * runner so all drivers (`postgres.js`, `node-postgres`, Neon, …) share one
 * migration path instead of drifting per preset.
 */
import {
  duplicateGroupsSql,
  logSkippedIndex,
  parseUniqueIndex,
} from "@storyshelf/core/adapter/database";
import type { Logger } from "@storyshelf/core/logger";
import { DDL } from "./ddl.ts";
import { assertReviewSchema } from "./review-schema-check.ts";

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
const PROJECT_COMPONENT_OWNERS_ALTER =
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS component_owners TEXT";
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
const DESIGN_NODE_NOTIFIED_ALTER =
  "ALTER TABLE design_nodes ADD COLUMN IF NOT EXISTS notified_version TEXT";
const DESIGN_LINKS_UNIQUE_INDEX =
  "CREATE UNIQUE INDEX IF NOT EXISTS design_links_project_import_path_idx ON design_links (project_id, import_path)";
/** Pre-adapter Figma tables (replaced by design_nodes / design_credentials; no data is carried over). */
const LEGACY_DESIGN_DROPS = [
  "DROP TABLE IF EXISTS figma_nodes",
  "DROP TABLE IF EXISTS design_tokens",
  // Replaced by content_uses (ADR 0039); its per-hash counters cannot become per-build uses.
  "DROP TABLE IF EXISTS content_refs",
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
const BUILD_REVIEW_CYCLE_ALTER =
  "ALTER TABLE builds ADD COLUMN IF NOT EXISTS review_cycle INTEGER NOT NULL DEFAULT 0";
const BUILD_REVIEW_REQUESTED_CYCLE_ALTER =
  "ALTER TABLE builds ADD COLUMN IF NOT EXISTS review_requested_cycle INTEGER";
const BUILD_CAPTURE_JOB_ALTER = "ALTER TABLE builds ADD COLUMN IF NOT EXISTS capture_job_id TEXT";
/** A run in flight when the column was added owns the build it was started for (idempotent). */
const BUILD_CAPTURE_JOB_BACKFILL =
  "UPDATE builds SET capture_job_id = (SELECT j.job_id FROM capture_jobs j WHERE j.entry = 'job' AND j.kind = 'capture' AND j.shard_id IS NULL AND j.cancel_requested_at IS NULL AND j.status IN ('queued', 'running') AND j.build_id = builds.id LIMIT 1) WHERE capture_job_id IS NULL AND status IN ('pending', 'capturing') AND (SELECT COUNT(*) FROM capture_jobs j WHERE j.entry = 'job' AND j.kind = 'capture' AND j.shard_id IS NULL AND j.cancel_requested_at IS NULL AND j.status IN ('queued', 'running') AND j.build_id = builds.id) = 1";
const BUILD_CAPTURE_GENERATION_ALTER =
  "ALTER TABLE builds ADD COLUMN IF NOT EXISTS capture_generation INTEGER NOT NULL DEFAULT 0";
const SNAPSHOT_UNSTABLE_ALTER = "ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS unstable BOOLEAN";
const DETECT_UNSTABLE_ALTER =
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS detect_unstable BOOLEAN NOT NULL DEFAULT true";
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
/**
 * Single-flight jobs (ADR 0040): `capture_jobs.active_key` is unique while a job is non-terminal.
 * Without the index two notify jobs for one key could run at once, so a failure must stop the
 * boot (as it must for every migration statement). Every statement is idempotent.
 */
const CAPTURE_JOB_SINGLE_FLIGHT = [
  "ALTER TABLE capture_jobs ADD COLUMN IF NOT EXISTS active_key TEXT",
  "ALTER TABLE capture_jobs ADD COLUMN IF NOT EXISTS rerun_requested_at TIMESTAMPTZ",
  "CREATE UNIQUE INDEX IF NOT EXISTS capture_jobs_active_key_idx ON capture_jobs (active_key)",
];

const USER_AUTH_ALTERS = [
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name_override TEXT",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'oidc'",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT false",
];
const COMMENT_STORY_ID_ALTER = "ALTER TABLE comments ADD COLUMN IF NOT EXISTS story_id TEXT";
const SUBSCRIPTION_REVIEW_REQUESTS_ALTER =
  "ALTER TABLE notification_subscriptions ADD COLUMN IF NOT EXISTS review_requests BOOLEAN NOT NULL DEFAULT TRUE";
const COMMENT_MENTIONS_ALTER = "ALTER TABLE comments ADD COLUMN IF NOT EXISTS mentions TEXT";
const COMMENT_KIND_ALTER =
  "ALTER TABLE comments ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'comment'";
const COMMENT_RESOLVED_AT_ALTER =
  "ALTER TABLE comments ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ";
const COMMENT_RESOLVED_BY_ALTER = "ALTER TABLE comments ADD COLUMN IF NOT EXISTS resolved_by TEXT";
const NOTIFICATION_LAST_ERROR_ALTER =
  "ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS last_error TEXT";
const NOTIFICATION_LAST_ERROR_AT_ALTER =
  "ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ";
const NOTIFICATION_LAST_DELIVERED_ALTER =
  "ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS last_delivered_at TIMESTAMPTZ";
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

async function migrateSnapshotColumns(run: MigrationRunner, logger?: Logger): Promise<void> {
  await run(SNAPSHOT_INFRA_HASH_ALTER);
  await run(SNAPSHOT_INHERITED_ALTER);
  await run(SNAPSHOT_BASELINE_ID_ALTER);
  await run(SNAPSHOT_BASELINE_VERSION_ALTER);
  await migrateComparisonColumns(run);
  await run(SNAPSHOT_DESIGN_URL_ALTER);
  await run(SNAPSHOT_ENV_CHANGE_ALTER);
  await run(SNAPSHOT_DURATION_ALTER);
  await run(SNAPSHOT_A11Y_ALTER);
  await migrateCaptureIdentityColumns(run, logger);
}

async function migrateComparisonColumns(run: MigrationRunner): Promise<void> {
  await run(SNAPSHOT_SOURCE_BUILD_ALTER);
  await run(SNAPSHOT_COMPARISON_IMAGE_ALTER);
  await run(SNAPSHOT_COMPARISON_METADATA_ALTER);
}

async function migrateCaptureIdentityColumns(run: MigrationRunner, logger?: Logger): Promise<void> {
  await run(SNAPSHOT_MODE_ALTER);
  await run(SNAPSHOT_BROWSER_ALTER);
  await run(BASELINE_MODE_ALTER);
  await run(BASELINE_BROWSER_ALTER);
  await run(PROJECT_BROWSERS_ALTER);
  await run(PROJECT_MODES_ALLOWLIST_ALTER);
  await runUniqueIndex(run, DESIGN_LINKS_UNIQUE_INDEX, logger);
  await Promise.all(
    LEGACY_DESIGN_DROPS.map(async (statement) => {
      await run(statement);
    }),
  );
}

async function migrateBaselineColumns(run: MigrationRunner): Promise<void> {
  await run(BASELINE_INFRA_HASH_ALTER);
  await run(BASELINE_FINGERPRINT_ALTER);
  await run(BASELINE_SOURCE_BUILD_ALTER);
}

async function migrateProjectExtras(run: MigrationRunner, logger?: Logger): Promise<void> {
  await run(EXECUTE_PLAY_ALTER);
  await run(PLAY_TIMEOUT_MS_ALTER);
  await run(PROJECT_AUTOMIGRATE_ALTER);
  await run(PROJECT_AI_PROFILE_ALTER);
  await migrateProjectReviewColumns(run);
  await migrateSnapshotColumns(run, logger);
  await migrateBaselineColumns(run);
  await migrateBuildColumns(run);
  await run(RUN_TESTS_ALTER);
  await migrateRecentColumns(run);
}

/** Columns added after the first adapter release; each is an idempotent `ADD COLUMN IF NOT EXISTS`. */
async function migrateRecentColumns(run: MigrationRunner): Promise<void> {
  await migrateDesignColumns(run);
  await migrateUnstableColumns(run);
}

async function migrateUnstableColumns(run: MigrationRunner): Promise<void> {
  await run(SNAPSHOT_UNSTABLE_ALTER);
  await run(DETECT_UNSTABLE_ALTER);
}

async function migrateDesignColumns(run: MigrationRunner): Promise<void> {
  await run(DESIGN_NODE_NOTIFIED_ALTER);
}

async function migrateProjectReviewColumns(run: MigrationRunner): Promise<void> {
  await run(PROJECT_REVIEW_ENABLED_ALTER);
  await run(PROJECT_REVIEW_APPROVALS_ALTER);
  await run(PROJECT_STORYBOOK_URL_TTL_ALTER);
  await run(PROJECT_COMPONENT_OWNERS_ALTER);
}

async function migrateBuildColumns(run: MigrationRunner): Promise<void> {
  await run(BUILD_AFFECTED_ONLY_ALTER);
  await run(BUILD_BASELINE_SHA_ALTER);
  await run(BUILD_CHANGED_FILES_ALTER);
  await run(BUILD_AFFECTED_PATHS_ALTER);
  await run(BUILD_INHERITED_COUNT_ALTER);
  await run(BUILD_TEST_RESULTS_ALTER);
  await run(BUILD_REVIEW_CYCLE_ALTER);
  await run(BUILD_REVIEW_REQUESTED_CYCLE_ALTER);
  await run(BUILD_CAPTURE_JOB_ALTER);
  await run(BUILD_CAPTURE_GENERATION_ALTER);
}

/** Run the full migration set through any row-query runner. */
export async function runMigrations(run: MigrationRunner, logger?: Logger): Promise<void> {
  await assertReviewSchema(run);
  await run(DDL);
  await migrateCoreColumns(run);
  await migrateUserAuthColumns(run);
  await migrateCaptureJobSingleFlight(run);
  await migrateProjectExtras(run, logger);
  // An unfenced build would let a late crash hook fail a newer run.
  await run(BUILD_CAPTURE_JOB_BACKFILL);
  await applyIdentityStatements(run, logger);
  await migrateCommentsTable(run);
  await migrateNotificationColumns(run);
}

/**
 * If the columns cannot be added the boot must fail loudly, because a missing `disabled` column
 * means access control silently does not work. `ADD COLUMN IF NOT EXISTS` is already idempotent,
 * so there is no "already done" error to ignore.
 */
async function migrateUserAuthColumns(run: MigrationRunner): Promise<void> {
  for (const statement of USER_AUTH_ALTERS) {
    // oxlint-disable-next-line no-await-in-loop -- ordered, and a failure must stop the boot
    await run(statement);
  }
}

async function migrateCaptureJobSingleFlight(run: MigrationRunner): Promise<void> {
  for (const statement of CAPTURE_JOB_SINGLE_FLIGHT) {
    // oxlint-disable-next-line no-await-in-loop -- ordered (columns, then the index), and a failure must stop the boot
    await run(statement);
  }
}

async function migrateRunA11yDefault(run: MigrationRunner): Promise<void> {
  await run(RUN_A11Y_ALTER);
  await run(RUN_A11Y_DEFAULT_ALTER);
}

async function migrateCoreColumns(run: MigrationRunner): Promise<void> {
  await run(STORYBOOK_META_ALTER);
  await migrateRunA11yDefault(run);
  await run(PROJECT_BROWSER_ALTER);
  await run(PROJECT_VIEWPORTS_ALTER);
  await run(WEBHOOK_SECRET_ALTER);
  await run(WEBHOOK_SECRET_DROP);
  await run(TOKEN_USER_ALTER);
  await run(MEMBER_SOURCE_ALTER);
  await run(BUILDS_GITSHA_DEDUP);
  await run(BUILDS_GITSHA_INDEX);
}

async function applyIdentityStatements(run: MigrationRunner, logger?: Logger): Promise<void> {
  for (const statement of IDENTITY_STATEMENTS) {
    // oxlint-disable-next-line no-await-in-loop -- ordered: drop old indexes, then create new
    await (statement.startsWith("CREATE UNIQUE INDEX")
      ? runUniqueIndex(run, statement, logger)
      : run(statement));
  }
}

/** SQLSTATE of a unique violation: a unique index over rows that already repeat its key. */
const UNIQUE_VIOLATION = "23505";

/**
 * Create a unique index. Rows from before the index may already repeat its key, which fails the
 * statement with a unique violation; that one error is skipped (the index is then not built) and
 * every other failure stops the boot.
 */
async function runUniqueIndex(run: MigrationRunner, sql: string, logger?: Logger): Promise<void> {
  try {
    await run(sql);
  } catch (error) {
    if ((error as { code?: unknown }).code !== UNIQUE_VIOLATION) {
      throw error;
    }
    await reportSkippedIndex(run, sql, logger);
  }
}

/** Say once that the index was skipped, with how many keys repeat (never a row). */
async function reportSkippedIndex(
  run: MigrationRunner,
  sql: string,
  logger: Logger | undefined,
): Promise<void> {
  const parsed = parseUniqueIndex(sql);
  if (parsed === null) return;
  const rows = (await run(duplicateGroupsSql(parsed.table, parsed.columns))) as {
    duplicate_groups?: unknown;
  }[];
  logSkippedIndex(logger, { ...parsed, duplicateGroups: Number(rows[0]?.duplicate_groups ?? 0) });
}

async function migrateNotificationColumns(run: MigrationRunner): Promise<void> {
  await run(NOTIFICATION_LAST_ERROR_ALTER);
  await run(NOTIFICATION_LAST_ERROR_AT_ALTER);
  await run(NOTIFICATION_LAST_DELIVERED_ALTER);
}

/** The columns the comments table gained after it first shipped. */
async function migrateCommentColumns(run: MigrationRunner): Promise<void> {
  await run(COMMENT_STORY_ID_ALTER);
  await run(COMMENT_MENTIONS_ALTER);
  await run(SUBSCRIPTION_REVIEW_REQUESTS_ALTER);
  await run(COMMENT_KIND_ALTER);
  await run(COMMENT_RESOLVED_AT_ALTER);
  await run(COMMENT_RESOLVED_BY_ALTER);
}

async function migrateCommentsTable(run: MigrationRunner): Promise<void> {
  await migrateCommentColumns(run);
  const rows = (await run(
    "SELECT is_nullable FROM information_schema.columns WHERE table_name='comments' AND column_name='user_id'",
  )) as { is_nullable: string }[];
  // Dropping NOT NULL on a nullable column is a no-op, so only a column that still has it needs the ALTER.
  if (rows[0]?.is_nullable === "NO") {
    await run("ALTER TABLE comments ALTER COLUMN user_id DROP NOT NULL");
  }
}
