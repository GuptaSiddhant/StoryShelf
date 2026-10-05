/** Canonical MySQL DDL for all StoryShelf tables and indexes. */
export const DDL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  git_repository TEXT,
  git_default_branch TEXT NOT NULL DEFAULT 'main',
  pixel_threshold DOUBLE NOT NULL DEFAULT 0.1,
  max_diff_ratio DOUBLE NOT NULL DEFAULT 0.01,
  public_branch_regex TEXT,
  storybook_meta TEXT,
  execute_play TINYINT(1) NOT NULL DEFAULT false,
  play_timeout_ms INTEGER NOT NULL DEFAULT 10000,
  run_a11y TINYINT(1) NOT NULL DEFAULT false,
  browser TEXT NOT NULL DEFAULT 'chromium',
  viewports TEXT,
  automigrate TINYINT(1) NOT NULL DEFAULT false,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS project_status_configs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  config TEXT NOT NULL,
  token_encrypted TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS builds (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  git_sha TEXT NOT NULL,
  git_branch TEXT NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT false,
  author_email TEXT,
  author_name TEXT,
  message TEXT,
  public TINYINT(1) NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending',
  snapshot_count INTEGER NOT NULL DEFAULT 0,
  changed_count INTEGER NOT NULL DEFAULT 0,
  approved_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  affected_only TINYINT(1) NOT NULL DEFAULT true,
  baseline_sha TEXT,
  changed_files TEXT,
  affected_import_paths TEXT,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
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
  queued_at DATETIME(3) NOT NULL,
  started_at DATETIME(3),
  finished_at DATETIME(3),
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS capture_attempts_build_no_idx ON capture_attempts (build_id, attempt_no);
CREATE INDEX IF NOT EXISTS capture_attempts_build_id_idx ON capture_attempts (build_id);
CREATE TABLE IF NOT EXISTS capture_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL REFERENCES capture_attempts(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  fields TEXT,
  created_at DATETIME(3) NOT NULL
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
  viewport_name TEXT NOT NULL DEFAULT 'desktop',
  viewport_width INTEGER NOT NULL DEFAULT 1280,
  viewport_height INTEGER NOT NULL DEFAULT 720,
  screenshot_path TEXT NOT NULL,
  diff_path TEXT,
  diff_pixels INTEGER,
  diff_ratio DOUBLE,
  diff_passed TINYINT(1),
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT,
  reviewed_at DATETIME(3),
  infra_hash TEXT,
  inherited TINYINT(1) NOT NULL DEFAULT false,
  baseline_id TEXT,
  baseline_version TEXT,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS snapshots_build_story_viewport_idx ON snapshots (build_id, story_id, viewport_name);
CREATE INDEX IF NOT EXISTS snapshots_build_id_idx ON snapshots (build_id);
CREATE TABLE IF NOT EXISTS baselines (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  story_id TEXT NOT NULL,
  viewport_name TEXT NOT NULL DEFAULT 'desktop',
  branch TEXT NOT NULL,
  snapshot_id TEXT,
  screenshot_path TEXT NOT NULL,
  infra_hash TEXT,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS baselines_project_story_viewport_branch_idx ON baselines (project_id, story_id, viewport_name, branch);
CREATE INDEX IF NOT EXISTS baselines_project_story_idx ON baselines (project_id, story_id);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  last_login_at DATETIME(3),
  created_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  snapshot_id TEXT REFERENCES snapshots(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  parent_id TEXT,
  resolved TINYINT(1) NOT NULL DEFAULT false,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_build_id_idx ON comments (build_id);
CREATE TABLE IF NOT EXISTS label_types (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  link_template TEXT,
  color TEXT,
  created_at DATETIME(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS label_types_project_key_idx ON label_types (project_id, key);
CREATE TABLE IF NOT EXISTS build_labels (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  type_key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS build_labels_build_type_value_idx ON build_labels (build_id, type_key, value);
CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  last_used_at DATETIME(3),
  created_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret_encrypted TEXT NOT NULL,
  events TEXT,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS notification_channels (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  config TEXT NOT NULL,
  secret_encrypted TEXT,
  events TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
CREATE INDEX notification_channels_project_id_idx ON notification_channels (project_id);
CREATE TABLE IF NOT EXISTS notification_subscriptions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  events TEXT,
  via TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL
);
CREATE UNIQUE INDEX notification_subscriptions_project_user_idx ON notification_subscriptions (project_id, user_id);
CREATE TABLE IF NOT EXISTS user_invite_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3),
  created_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS project_members (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at DATETIME(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS project_members_project_user_idx ON project_members (project_id, user_id);
CREATE TABLE IF NOT EXISTS project_group_mappings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  group_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_at DATETIME(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS project_group_mappings_project_group_idx ON project_group_mappings (project_id, group_name);
CREATE TABLE IF NOT EXISTS content_refs (
  hash TEXT PRIMARY KEY,
  ref_count INTEGER NOT NULL DEFAULT 1,
  last_seen_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS "user" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified TINYINT(1) NOT NULL DEFAULT false,
  image TEXT,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at DATETIME(3) NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS session_token_idx ON session (token);
CREATE INDEX IF NOT EXISTS session_user_id_idx ON session (user_id);
CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
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
  updated_at DATETIME(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS account_user_id_idx ON account (user_id);
CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification (identifier);
CREATE TABLE IF NOT EXISTS passkey (
  id TEXT PRIMARY KEY,
  name TEXT,
  public_key TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL,
  counter INTEGER NOT NULL,
  device_type TEXT NOT NULL,
  backed_up TINYINT(1) NOT NULL DEFAULT false,
  transports TEXT,
  aaguid TEXT,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3)
);
CREATE INDEX IF NOT EXISTS passkey_user_id_idx ON passkey (user_id);
CREATE INDEX IF NOT EXISTS passkey_credential_id_idx ON passkey (credential_id);
CREATE TABLE IF NOT EXISTS "ssoProvider" (
  id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  oidc_config TEXT,
  saml_config TEXT,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL UNIQUE,
  organization_id TEXT,
  domain TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ssoprovider_domain_idx ON "ssoProvider" (domain);
`;
