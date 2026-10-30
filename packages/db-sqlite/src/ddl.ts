/** Canonical SQLite DDL for all StoryShelf tables and indexes. */
export const DDL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  git_repository TEXT,
  git_default_branch TEXT NOT NULL DEFAULT 'main',
  pixel_threshold REAL NOT NULL DEFAULT 0.1,
  max_diff_ratio REAL NOT NULL DEFAULT 0.01,
  public_branch_regex TEXT,
  storybook_meta TEXT,
  execute_play INTEGER NOT NULL DEFAULT 0,
  play_timeout_ms INTEGER NOT NULL DEFAULT 10000,
  run_a11y INTEGER NOT NULL DEFAULT 1,
  run_tests INTEGER NOT NULL DEFAULT 0,
  browser TEXT NOT NULL DEFAULT 'chromium',
  viewports TEXT,
  browsers TEXT,
  modes_allowlist TEXT,
  automigrate INTEGER NOT NULL DEFAULT 0,
  ai_profile TEXT,
  review_enabled INTEGER NOT NULL DEFAULT 1,
  review_approvals INTEGER NOT NULL DEFAULT 1,
  storybook_url_ttl_seconds INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS builds (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  git_sha TEXT NOT NULL,
  git_branch TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  author_email TEXT,
  author_name TEXT,
  message TEXT,
  public INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  snapshot_count INTEGER NOT NULL DEFAULT 0,
  changed_count INTEGER NOT NULL DEFAULT 0,
  approved_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  inherited_count INTEGER NOT NULL DEFAULT 0,
  affected_only INTEGER NOT NULL DEFAULT 1,
  baseline_sha TEXT,
  changed_files TEXT,
  affected_import_paths TEXT,
  test_results TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS builds_project_gitsha_idx ON builds (project_id, git_sha);
CREATE INDEX IF NOT EXISTS builds_git_branch_idx ON builds (git_branch);
CREATE TABLE IF NOT EXISTS capture_attempts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  req_id TEXT,
  story_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  queued_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS capture_attempts_build_no_idx ON capture_attempts (build_id, attempt_no);
CREATE INDEX IF NOT EXISTS capture_attempts_build_id_idx ON capture_attempts (build_id);
CREATE TABLE IF NOT EXISTS capture_shards (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_id TEXT,
  payload TEXT,
  result TEXT,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS capture_shards_build_kind_ordinal_idx ON capture_shards (build_id, kind, ordinal);
CREATE INDEX IF NOT EXISTS capture_shards_build_id_idx ON capture_shards (build_id);
CREATE TABLE IF NOT EXISTS capture_jobs (
  id TEXT PRIMARY KEY,
  entry TEXT NOT NULL,
  job_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  build_id TEXT,
  shard_id TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL,
  visible_at TEXT,
  owner TEXT,
  payload TEXT,
  cancel_requested_at TEXT,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS capture_jobs_poll_idx ON capture_jobs (kind, visible_at, status);
CREATE INDEX IF NOT EXISTS capture_jobs_job_id_idx ON capture_jobs (job_id);
CREATE INDEX IF NOT EXISTS capture_jobs_build_id_idx ON capture_jobs (build_id);
CREATE INDEX IF NOT EXISTS capture_jobs_entry_created_idx ON capture_jobs (entry, created_at);
CREATE TABLE IF NOT EXISTS site_settings (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS build_components (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  import_path TEXT NOT NULL,
  title TEXT NOT NULL,
  story_count INTEGER NOT NULL DEFAULT 0,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS build_components_build_id_idx ON build_components (build_id);
CREATE INDEX IF NOT EXISTS build_components_project_import_path_idx ON build_components (project_id, import_path);
CREATE TABLE IF NOT EXISTS capture_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL REFERENCES capture_attempts(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  fields TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS capture_logs_attempt_seq_idx ON capture_logs (attempt_id, seq);
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  story_id TEXT NOT NULL,
  story_name TEXT NOT NULL,
  story_title TEXT NOT NULL,
  story_import_path TEXT,
  design_url TEXT,
  viewport_name TEXT NOT NULL DEFAULT 'desktop',
  viewport_width INTEGER NOT NULL DEFAULT 1280,
  viewport_height INTEGER NOT NULL DEFAULT 720,
  screenshot_path TEXT NOT NULL,
  diff_path TEXT,
  diff_pixels INTEGER,
  diff_ratio REAL,
  diff_passed INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT,
  reviewed_at TEXT,
  infra_hash TEXT,
  env_change TEXT,
  inherited INTEGER NOT NULL DEFAULT 0,
  baseline_id TEXT,
  baseline_version TEXT,
  source_build_id TEXT,
  mode TEXT,
  browser TEXT NOT NULL DEFAULT 'chromium',
  duration_ms INTEGER,
  a11y_violations TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS snapshots_build_id_idx ON snapshots (build_id);
CREATE TABLE IF NOT EXISTS baselines (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  story_id TEXT NOT NULL,
  viewport_name TEXT NOT NULL DEFAULT 'desktop',
  branch TEXT NOT NULL,
  snapshot_id TEXT,
  source_build_id TEXT,
  screenshot_path TEXT NOT NULL,
  infra_hash TEXT,
  fingerprint TEXT,
  mode TEXT,
  browser TEXT NOT NULL DEFAULT 'chromium',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS baselines_project_story_idx ON baselines (project_id, story_id);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  snapshot_id TEXT REFERENCES snapshots(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  parent_id TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  story_id TEXT
);
CREATE INDEX IF NOT EXISTS comments_build_id_idx ON comments (build_id);
CREATE TABLE IF NOT EXISTS build_reviews (
  id TEXT PRIMARY KEY,
  build_id TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL,
  body TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS build_reviews_build_id_idx ON build_reviews (build_id);
CREATE TABLE IF NOT EXISTS label_types (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  link_template TEXT,
  color TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS label_types_project_key_idx ON label_types (project_id, key);
CREATE TABLE IF NOT EXISTS build_labels (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  type_key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS build_labels_build_type_value_idx ON build_labels (build_id, type_key, value);
CREATE TABLE IF NOT EXISTS project_links (
  id TEXT PRIMARY KEY,
  downstream_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  upstream_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  package_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS project_links_downstream_package_idx ON project_links (downstream_id, package_name);
CREATE TABLE IF NOT EXISTS design_links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  import_path TEXT,
  label TEXT,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS design_links_project_id_idx ON design_links (project_id);
CREATE TABLE IF NOT EXISTS design_credentials (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  token_encrypted TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS design_credentials_project_provider_idx ON design_credentials (project_id, provider);
CREATE TABLE IF NOT EXISTS design_nodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  viewer_id TEXT NOT NULL DEFAULT '',
  file_key TEXT NOT NULL,
  node_id TEXT NOT NULL DEFAULT '',
  name TEXT,
  version TEXT,
  last_modified TEXT,
  state TEXT NOT NULL DEFAULT 'ok',
  render_path TEXT,
  render_version TEXT,
  fetched_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS design_nodes_project_file_node_idx ON design_nodes (project_id, provider, viewer_id, file_key, node_id);
CREATE TABLE IF NOT EXISTS build_package_usage (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  story_import_path TEXT NOT NULL,
  package_name TEXT NOT NULL,
  module_path TEXT NOT NULL,
  version TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS build_package_usage_build_id_idx ON build_package_usage (build_id);
CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  last_used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret_encrypted TEXT NOT NULL,
  events TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notification_channels (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  config TEXT NOT NULL,
  secret_encrypted TEXT,
  events TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  last_error_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notification_channels_project_id_idx ON notification_channels (project_id);
CREATE TABLE IF NOT EXISTS notification_subscriptions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  events TEXT,
  via TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_subscriptions_project_user_idx ON notification_subscriptions (project_id, user_id);
CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_id TEXT REFERENCES builds(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  window_key TEXT,
  input_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  profile TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  verdict TEXT,
  summary TEXT,
  result TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS insights_project_build_idx ON insights (project_id, build_id);
CREATE INDEX IF NOT EXISTS insights_created_at_idx ON insights (created_at);
CREATE UNIQUE INDEX IF NOT EXISTS insights_triage_unique_idx ON insights (project_id, build_id, kind, input_hash);
CREATE UNIQUE INDEX IF NOT EXISTS insights_health_unique_idx ON insights (project_id, kind, window_key);
CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY,
  insight_id TEXT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  profile TEXT NOT NULL,
  task TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated INTEGER NOT NULL DEFAULT 0,
  images INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_usage_created_at_idx ON ai_usage (created_at);
CREATE INDEX IF NOT EXISTS ai_usage_project_created_idx ON ai_usage (project_id, created_at);
CREATE TABLE IF NOT EXISTS ai_budget_alerts (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  threshold INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  password_hash TEXT,
  display_name_override TEXT,
  auth_provider TEXT NOT NULL DEFAULT 'oidc',
  disabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS user_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service TEXT NOT NULL,
  token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS user_connections_user_service_idx ON user_connections (user_id, service);
CREATE TABLE IF NOT EXISTS user_invite_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS user_invite_tokens_user_id_idx ON user_invite_tokens (user_id);
CREATE TABLE IF NOT EXISTS project_members (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS project_members_project_user_idx ON project_members (project_id, user_id);
CREATE TABLE IF NOT EXISTS project_group_mappings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  group_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS project_group_mappings_project_group_idx ON project_group_mappings (project_id, group_name);
CREATE TABLE IF NOT EXISTS content_refs (
  hash TEXT PRIMARY KEY,
  ref_count INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS session_token_idx ON session (token);
CREATE INDEX IF NOT EXISTS session_user_id_idx ON session (user_id);
CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at TEXT,
  refresh_token_expires_at TEXT,
  scope TEXT,
  expires_at TEXT,
  password TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS account_user_id_idx ON account (user_id);
CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification (identifier);
CREATE TABLE IF NOT EXISTS passkey (
  id TEXT PRIMARY KEY,
  name TEXT,
  public_key TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL,
  counter INTEGER NOT NULL,
  device_type TEXT NOT NULL,
  backed_up INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  aaguid TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS passkey_user_id_idx ON passkey (user_id);
CREATE INDEX IF NOT EXISTS passkey_credential_id_idx ON passkey (credential_id);
CREATE TABLE IF NOT EXISTS ssoProvider (
  id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  oidc_config TEXT,
  saml_config TEXT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL UNIQUE,
  organization_id TEXT,
  domain TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ssoprovider_domain_idx ON ssoProvider (domain);
`;

/**
 * Indexes that must be created after `ensureColumns` (they reference columns
 * older volumes only gain then, or can fail on legacy duplicates). Runs the
 * browser-aware identity swap — rows default to `chromium` — plus the story-file
 * lookup index and the one-mapping-per-file unique index. Idempotent; a step
 * that fails (e.g. duplicate mappings from before the unique index) is skipped, not fatal.
 */
export const IDENTITY_STATEMENTS: string[] = [
  "DROP INDEX IF EXISTS snapshots_build_story_viewport_idx",
  "DROP INDEX IF EXISTS baselines_project_story_viewport_branch_idx",
  "CREATE UNIQUE INDEX IF NOT EXISTS snapshots_build_story_mode_browser_idx ON snapshots (build_id, story_id, viewport_name, browser)",
  "CREATE UNIQUE INDEX IF NOT EXISTS baselines_project_story_mode_browser_branch_idx ON baselines (project_id, story_id, viewport_name, browser, branch)",
  "CREATE INDEX IF NOT EXISTS snapshots_project_import_path_idx ON snapshots (project_id, story_import_path)",
  "CREATE UNIQUE INDEX IF NOT EXISTS design_links_project_import_path_idx ON design_links (project_id, import_path)",
  // Pre-adapter Figma tables, replaced by design_nodes / design_credentials (no data is carried over).
  "DROP TABLE IF EXISTS figma_nodes",
  "DROP TABLE IF EXISTS design_tokens",
];

const CONSTRAINT_PREFIX = /^(?:PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\s/iu;
const TABLE_BLOCK = /CREATE TABLE IF NOT EXISTS\s+(?<table>\w+)\s*\((?<body>[\s\S]*?)\n\);/gu;

/**
 * Parse the `CREATE TABLE` statements in a DDL string into a map of table name
 * → column definition fragments (e.g. `name TEXT NOT NULL`). Table-level
 * constraints are skipped; every StoryShelf column is declared inline.
 */
export function tableColumns(ddl: string): Map<string, string[]> {
  const tables = new Map<string, string[]>();
  for (const match of ddl.matchAll(TABLE_BLOCK)) {
    const columns = (match.groups?.["body"] ?? "")
      .split("\n")
      .map((line) => line.trim().replace(/,$/u, ""))
      .filter((line) => line !== "" && !CONSTRAINT_PREFIX.test(line));
    const table = match.groups?.["table"];
    if (table) {
      tables.set(table, columns);
    }
  }
  return tables;
}
