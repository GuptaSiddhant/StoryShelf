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
  run_a11y INTEGER NOT NULL DEFAULT 0,
  browser TEXT NOT NULL DEFAULT 'chromium',
  viewports TEXT,
  automigrate INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_status_configs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  config TEXT NOT NULL,
  token_encrypted TEXT NOT NULL,
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
  affected_only INTEGER NOT NULL DEFAULT 1,
  baseline_sha TEXT,
  changed_files TEXT,
  affected_import_paths TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS builds_project_gitsha_idx ON builds (project_id, git_sha);
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
  inherited INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS baselines_project_story_viewport_branch_idx ON baselines (project_id, story_id, viewport_name, branch);
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
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_build_id_idx ON comments (build_id);
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
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  last_login_at TEXT,
  created_at TEXT NOT NULL
);
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
`;

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
