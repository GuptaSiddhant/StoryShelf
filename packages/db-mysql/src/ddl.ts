/** Canonical MySQL DDL for all StoryShelf tables and indexes. */
export const DDL = `
CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(64) PRIMARY KEY,
  name TEXT NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  git_repository TEXT,
  git_default_branch VARCHAR(255) NOT NULL DEFAULT 'main',
  pixel_threshold DOUBLE NOT NULL DEFAULT 0.1,
  max_diff_ratio DOUBLE NOT NULL DEFAULT 0.01,
  public_branch_regex TEXT,
  storybook_meta TEXT,
  execute_play TINYINT(1) NOT NULL DEFAULT false,
  play_timeout_ms INTEGER NOT NULL DEFAULT 10000,
  run_a11y TINYINT(1) NOT NULL DEFAULT true,
  run_tests TINYINT(1) NOT NULL DEFAULT false,
  browser VARCHAR(64) NOT NULL DEFAULT 'chromium',
  viewports TEXT,
  browsers TEXT,
  modes_allowlist TEXT,
  automigrate TINYINT(1) NOT NULL DEFAULT false,
  ai_profile TEXT,
  review_enabled TINYINT(1) NOT NULL DEFAULT true,
  review_approvals INT NOT NULL DEFAULT 1,
  storybook_url_ttl_seconds INT,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS builds (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  git_sha VARCHAR(64) NOT NULL,
  git_branch VARCHAR(255) NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT false,
  author_email TEXT,
  author_name TEXT,
  message TEXT,
  public TINYINT(1) NOT NULL DEFAULT false,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  snapshot_count INTEGER NOT NULL DEFAULT 0,
  changed_count INTEGER NOT NULL DEFAULT 0,
  approved_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  inherited_count INTEGER NOT NULL DEFAULT 0,
  affected_only TINYINT(1) NOT NULL DEFAULT true,
  baseline_sha TEXT,
  changed_files TEXT,
  affected_import_paths TEXT,
  test_results TEXT,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_builds_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX builds_project_gitsha_idx ON builds (project_id, git_sha);
CREATE INDEX builds_git_branch_idx ON builds (git_branch);
CREATE TABLE IF NOT EXISTS capture_attempts (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  build_id VARCHAR(64) NOT NULL,
  attempt_no INTEGER NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  error TEXT,
  req_id TEXT,
  story_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  queued_at DATETIME(3) NOT NULL,
  started_at DATETIME(3),
  finished_at DATETIME(3),
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_capture_attempts_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_capture_attempts_build_id FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX capture_attempts_build_no_idx ON capture_attempts (build_id, attempt_no);
CREATE INDEX capture_attempts_build_id_idx ON capture_attempts (build_id);
CREATE TABLE IF NOT EXISTS capture_shards (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  build_id VARCHAR(64) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  ordinal INTEGER NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  attempt_id VARCHAR(64),
  payload TEXT,
  result TEXT,
  error TEXT,
  started_at DATETIME(3),
  finished_at DATETIME(3),
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_capture_shards_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_capture_shards_build_id FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX capture_shards_build_kind_ordinal_idx ON capture_shards (build_id, kind, ordinal);
CREATE INDEX capture_shards_build_id_idx ON capture_shards (build_id);
CREATE TABLE IF NOT EXISTS capture_jobs (
  id VARCHAR(64) PRIMARY KEY,
  entry VARCHAR(64) NOT NULL,
  job_id VARCHAR(64) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  build_id VARCHAR(64),
  shard_id VARCHAR(64),
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  status VARCHAR(32) NOT NULL,
  visible_at DATETIME(3),
  owner TEXT,
  payload TEXT,
  cancel_requested_at DATETIME(3),
  error TEXT,
  started_at DATETIME(3),
  finished_at DATETIME(3),
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
CREATE INDEX capture_jobs_poll_idx ON capture_jobs (kind, visible_at, status);
CREATE INDEX capture_jobs_job_id_idx ON capture_jobs (job_id);
CREATE INDEX capture_jobs_build_id_idx ON capture_jobs (build_id);
CREATE INDEX capture_jobs_entry_created_idx ON capture_jobs (entry, created_at);
CREATE TABLE IF NOT EXISTS site_settings (
  id VARCHAR(64) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS build_components (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  build_id VARCHAR(64) NOT NULL,
  import_path VARCHAR(512) NOT NULL,
  title TEXT NOT NULL,
  story_count INTEGER NOT NULL DEFAULT 0,
  hash TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_build_components_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_build_components_build_id FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE CASCADE
);
CREATE INDEX build_components_build_id_idx ON build_components (build_id);
CREATE INDEX build_components_project_import_path_idx ON build_components (project_id, import_path);
CREATE TABLE IF NOT EXISTS capture_logs (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  build_id VARCHAR(64) NOT NULL,
  attempt_id VARCHAR(64) NOT NULL,
  seq INTEGER NOT NULL,
  level VARCHAR(16) NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  fields TEXT,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_capture_logs_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_capture_logs_build_id FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE CASCADE,
  CONSTRAINT fk_capture_logs_attempt_id FOREIGN KEY (attempt_id) REFERENCES capture_attempts(id) ON DELETE CASCADE
);
CREATE INDEX capture_logs_attempt_seq_idx ON capture_logs (attempt_id, seq);
CREATE TABLE IF NOT EXISTS snapshots (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  build_id VARCHAR(64) NOT NULL,
  story_id VARCHAR(255) NOT NULL,
  story_name TEXT NOT NULL,
  story_title TEXT NOT NULL,
  story_import_path VARCHAR(512),
  design_url TEXT,
  viewport_name VARCHAR(64) NOT NULL DEFAULT 'desktop',
  viewport_width INTEGER NOT NULL DEFAULT 1280,
  viewport_height INTEGER NOT NULL DEFAULT 720,
  screenshot_path TEXT NOT NULL,
  diff_path TEXT,
  diff_pixels INTEGER,
  diff_ratio DOUBLE,
  diff_passed TINYINT(1),
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  reviewed_by TEXT,
  reviewed_at DATETIME(3),
  infra_hash TEXT,
  env_change TEXT,
  inherited TINYINT(1) NOT NULL DEFAULT false,
  baseline_id VARCHAR(64),
  baseline_version TEXT,
  source_build_id TEXT,
  comparison_image_path TEXT,
  comparison_metadata TEXT,
  mode VARCHAR(64),
  browser VARCHAR(64) NOT NULL DEFAULT 'chromium',
  duration_ms INT,
  a11y_violations TEXT,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_snapshots_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_snapshots_build_id FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE CASCADE
);
CREATE INDEX snapshots_build_id_idx ON snapshots (build_id);
CREATE INDEX snapshots_project_import_path_idx ON snapshots (project_id, story_import_path);
CREATE TABLE IF NOT EXISTS baselines (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  story_id VARCHAR(255) NOT NULL,
  viewport_name VARCHAR(64) NOT NULL DEFAULT 'desktop',
  branch VARCHAR(255) NOT NULL,
  snapshot_id VARCHAR(64),
  source_build_id TEXT,
  screenshot_path TEXT NOT NULL,
  infra_hash TEXT,
  fingerprint TEXT,
  mode VARCHAR(64),
  browser VARCHAR(64) NOT NULL DEFAULT 'chromium',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_baselines_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX baselines_project_story_idx ON baselines (project_id, story_id);
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  role VARCHAR(32) NOT NULL DEFAULT 'member',
  last_login_at DATETIME(3),
  created_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS user_connections (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  service VARCHAR(64) NOT NULL,
  token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  expires_at DATETIME(3),
  status VARCHAR(32) NOT NULL DEFAULT 'ok',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_user_connections_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX user_connections_user_service_idx ON user_connections (user_id, service);
CREATE TABLE IF NOT EXISTS comments (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  build_id VARCHAR(64) NOT NULL,
  snapshot_id VARCHAR(64),
  user_id VARCHAR(64),
  body TEXT NOT NULL,
  parent_id TEXT,
  resolved TINYINT(1) NOT NULL DEFAULT false,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  story_id TEXT,
  CONSTRAINT fk_comments_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_build_id FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_snapshot_id FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX comments_build_id_idx ON comments (build_id);
CREATE TABLE IF NOT EXISTS build_reviews (
  id VARCHAR(64) PRIMARY KEY,
  build_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64),
  verdict TEXT NOT NULL,
  body TEXT,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_build_reviews_build_id FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE CASCADE,
  CONSTRAINT fk_build_reviews_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX build_reviews_build_id_idx ON build_reviews (build_id);
CREATE TABLE IF NOT EXISTS label_types (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  \`key\` VARCHAR(255) NOT NULL,
  name TEXT NOT NULL,
  link_template TEXT,
  color TEXT,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_label_types_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX label_types_project_key_idx ON label_types (project_id, \`key\`);
CREATE TABLE IF NOT EXISTS build_labels (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  build_id VARCHAR(64) NOT NULL,
  type_key VARCHAR(64) NOT NULL,
  value VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_build_labels_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_build_labels_build_id FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX build_labels_build_type_value_idx ON build_labels (build_id, type_key, value);
CREATE TABLE IF NOT EXISTS project_links (
  id VARCHAR(64) PRIMARY KEY,
  downstream_id VARCHAR(64) NOT NULL,
  upstream_id VARCHAR(64) NOT NULL,
  package_name VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_project_links_downstream_id FOREIGN KEY (downstream_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_links_upstream_id FOREIGN KEY (upstream_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX project_links_downstream_package_idx ON project_links (downstream_id, package_name);
CREATE TABLE IF NOT EXISTS design_links (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  import_path VARCHAR(512),
  label TEXT,
  url TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_design_links_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX design_links_project_id_idx ON design_links (project_id);
CREATE TABLE IF NOT EXISTS design_credentials (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  provider VARCHAR(64) NOT NULL,
  token_encrypted TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'unknown',
  checked_at DATETIME(3),
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_design_credentials_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX design_credentials_project_provider_idx ON design_credentials (project_id, provider);
CREATE TABLE IF NOT EXISTS design_nodes (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  provider VARCHAR(64) NOT NULL,
  viewer_id VARCHAR(128) NOT NULL DEFAULT '',
  file_key VARCHAR(128) NOT NULL,
  node_id VARCHAR(128) NOT NULL DEFAULT '',
  name TEXT,
  version TEXT,
  last_modified TEXT,
  state VARCHAR(32) NOT NULL DEFAULT 'ok',
  render_path TEXT,
  render_version TEXT,
  fetched_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_design_nodes_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX design_nodes_project_file_node_idx ON design_nodes (project_id, provider, viewer_id, file_key, node_id);
CREATE TABLE IF NOT EXISTS build_package_usage (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  build_id VARCHAR(64) NOT NULL,
  story_import_path TEXT NOT NULL,
  package_name TEXT NOT NULL,
  module_path TEXT NOT NULL,
  version TEXT,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_build_package_usage_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_build_package_usage_build_id FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE CASCADE
);
CREATE INDEX build_package_usage_build_id_idx ON build_package_usage (build_id);
CREATE TABLE IF NOT EXISTS tokens (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  name TEXT NOT NULL,
  hash VARCHAR(128) NOT NULL UNIQUE,
  user_id VARCHAR(64),
  last_used_at DATETIME(3),
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_tokens_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_tokens_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS webhooks (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  url TEXT NOT NULL,
  secret_encrypted TEXT NOT NULL,
  events TEXT,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_webhooks_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS notification_channels (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64),
  provider TEXT NOT NULL,
  config TEXT NOT NULL,
  secret_encrypted TEXT,
  events TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_error TEXT,
  last_error_at DATETIME(3),
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_notification_channels_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX notification_channels_project_id_idx ON notification_channels (project_id);
CREATE TABLE IF NOT EXISTS notification_subscriptions (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  events TEXT,
  via TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_notification_subscriptions_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_notification_subscriptions_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX notification_subscriptions_project_user_idx ON notification_subscriptions (project_id, user_id);
CREATE TABLE IF NOT EXISTS insights (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  build_id VARCHAR(64),
  kind VARCHAR(32) NOT NULL,
  window_key VARCHAR(64),
  input_hash VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  profile TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  verdict TEXT,
  summary TEXT,
  result TEXT,
  error_code TEXT,
  created_at DATETIME(3) NOT NULL,
  started_at DATETIME(3),
  finished_at DATETIME(3),
  CONSTRAINT fk_insights_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_insights_build_id FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE CASCADE
);
CREATE INDEX insights_project_build_idx ON insights (project_id, build_id);
CREATE INDEX insights_created_at_idx ON insights (created_at);
CREATE UNIQUE INDEX insights_triage_unique_idx ON insights (project_id, build_id, kind, input_hash);
CREATE UNIQUE INDEX insights_health_unique_idx ON insights (project_id, kind, window_key);
CREATE TABLE IF NOT EXISTS ai_usage (
  id VARCHAR(64) PRIMARY KEY,
  insight_id TEXT,
  project_id VARCHAR(64) NOT NULL,
  profile TEXT NOT NULL,
  task TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated TINYINT(1) NOT NULL DEFAULT false,
  images INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_ai_usage_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX ai_usage_created_at_idx ON ai_usage (created_at);
CREATE INDEX ai_usage_project_created_idx ON ai_usage (project_id, created_at);
CREATE TABLE IF NOT EXISTS ai_budget_alerts (
  id VARCHAR(64) PRIMARY KEY,
  day TEXT NOT NULL,
  threshold INTEGER NOT NULL,
  created_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS user_invite_tokens (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3),
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_user_invite_tokens_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS project_members (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'viewer',
  source VARCHAR(32) NOT NULL DEFAULT 'manual',
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_project_members_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_members_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX project_members_project_user_idx ON project_members (project_id, user_id);
CREATE TABLE IF NOT EXISTS project_group_mappings (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  group_name VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'viewer',
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_project_group_mappings_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX project_group_mappings_project_group_idx ON project_group_mappings (project_id, group_name);
CREATE TABLE IF NOT EXISTS content_refs (
  hash VARCHAR(128) PRIMARY KEY,
  ref_count INTEGER NOT NULL DEFAULT 1,
  last_seen_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS \`user\` (
  id VARCHAR(64) PRIMARY KEY,
  name TEXT NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  email_verified TINYINT(1) NOT NULL DEFAULT false,
  image TEXT,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS session (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  token VARCHAR(512) NOT NULL UNIQUE,
  expires_at DATETIME(3) NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_session_user_id FOREIGN KEY (user_id) REFERENCES \`user\`(id) ON DELETE CASCADE
);
CREATE INDEX session_token_idx ON session (token);
CREATE INDEX session_user_id_idx ON session (user_id);
CREATE TABLE IF NOT EXISTS account (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at DATETIME(3),
  refresh_token_expires_at DATETIME(3),
  scope TEXT,
  expires_at DATETIME(3),
  password TEXT,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_account_user_id FOREIGN KEY (user_id) REFERENCES \`user\`(id) ON DELETE CASCADE
);
CREATE INDEX account_user_id_idx ON account (user_id);
CREATE TABLE IF NOT EXISTS verification (
  id VARCHAR(64) PRIMARY KEY,
  identifier VARCHAR(255) NOT NULL,
  value TEXT NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
CREATE INDEX verification_identifier_idx ON verification (identifier);
CREATE TABLE IF NOT EXISTS passkey (
  id VARCHAR(64) PRIMARY KEY,
  name TEXT,
  public_key TEXT NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  credential_id VARCHAR(255) NOT NULL,
  counter INTEGER NOT NULL,
  device_type TEXT NOT NULL,
  backed_up TINYINT(1) NOT NULL DEFAULT false,
  transports TEXT,
  aaguid TEXT,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3),
  CONSTRAINT fk_passkey_user_id FOREIGN KEY (user_id) REFERENCES \`user\`(id) ON DELETE CASCADE
);
CREATE INDEX passkey_user_id_idx ON passkey (user_id);
CREATE INDEX passkey_credential_id_idx ON passkey (credential_id);
CREATE TABLE IF NOT EXISTS \`ssoProvider\` (
  id VARCHAR(64) PRIMARY KEY,
  issuer TEXT NOT NULL,
  oidc_config TEXT,
  saml_config TEXT,
  user_id VARCHAR(64) NOT NULL,
  provider_id VARCHAR(64) NOT NULL UNIQUE,
  organization_id TEXT,
  domain VARCHAR(255) NOT NULL,
  CONSTRAINT fk_ssoProvider_user_id FOREIGN KEY (user_id) REFERENCES \`user\`(id) ON DELETE CASCADE
);
CREATE INDEX ssoprovider_domain_idx ON \`ssoProvider\` (domain);
`;
