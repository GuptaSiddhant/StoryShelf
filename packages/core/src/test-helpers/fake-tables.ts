/**
 * Dialect-free stub tables for the in-memory test fake.
 *
 * The fake never touches a driver: it only needs table handles whose columns
 * carry the property → column-name mapping (`getTableColumns`) and flow
 * through drizzle's expression builders (`eq`, `and`, `inArray`, `orderBy`)
 * into the `sql-chunks.ts` matcher. Real `Column`/`Table` base classes from
 * the `drizzle-orm` root (already a core dependency) satisfy both without
 * pulling in any dialect package (`sqlite-core`, `pg-core`, …).
 */
import { Column, Table } from "drizzle-orm";
import type { Tables } from "../adapters/database.ts";

/** A column handle with driver passthrough mapping (the fake maps nothing). */
class FakeColumn extends Column {
  override getSQLType(): string {
    return this.columnType;
  }
}

// `Table.Symbol` is runtime-only (`@internal`, absent from the public types).
const columnsSymbol = (Table as unknown as { Symbol: { Columns: symbol } }).Symbol.Columns;

function defineTable(name: string, columns: Record<string, string>): Table {
  const table = new Table(name, undefined, name);
  const handles: Record<string, FakeColumn> = {};
  for (const [property, dbName] of Object.entries(columns)) {
    handles[property] = new FakeColumn(table, {
      name: dbName,
      keyAsName: false,
      notNull: false,
      default: undefined,
      defaultFn: undefined,
      onUpdateFn: undefined,
      hasDefault: false,
      primaryKey: false,
      isUnique: false,
      uniqueName: undefined,
      uniqueType: undefined,
      dataType: "string",
      columnType: "FakeColumn",
      generated: undefined,
      generatedIdentity: undefined,
    });
  }
  (table as unknown as Record<symbol, unknown>)[columnsSymbol] = handles;
  return table;
}

// Stub tables matching the real schema's property -> column mapping.
// No constraints or defaults — just names for whereMatches/orderRows.
const projects = defineTable("projects", {
  id: "id",
  name: "name",
  slug: "slug",
  gitRepository: "git_repository",
  gitDefaultBranch: "git_default_branch",
  pixelThreshold: "pixel_threshold",
  maxDiffRatio: "max_diff_ratio",
  publicBranchRegex: "public_branch_regex",
  storybookMeta: "storybook_meta",
  executePlay: "execute_play",
  playTimeoutMs: "play_timeout_ms",
  runA11y: "run_a11y",
  browser: "browser",
  viewports: "viewports",
  browsers: "browsers",
  modesAllowlist: "modes_allowlist",
  automigrate: "automigrate",
  aiProfile: "ai_profile",
  reviewEnabled: "review_enabled",
  reviewApprovals: "review_approvals",
  storybookUrlTtlSeconds: "storybook_url_ttl_seconds",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

const designLinks = defineTable("design_links", {
  id: "id",
  projectId: "project_id",
  importPath: "import_path",
  label: "label",
  url: "url",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

const designCredentials = defineTable("design_credentials", {
  id: "id",
  projectId: "project_id",
  provider: "provider",
  tokenEncrypted: "token_encrypted",
  status: "status",
  checkedAt: "checked_at",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

const userConnections = defineTable("user_connections", {
  id: "id",
  userId: "user_id",
  service: "service",
  tokenEncrypted: "token_encrypted",
  refreshTokenEncrypted: "refresh_token_encrypted",
  expiresAt: "expires_at",
  status: "status",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

const designNodes = defineTable("design_nodes", {
  id: "id",
  projectId: "project_id",
  provider: "provider",
  viewerId: "viewer_id",
  fileKey: "file_key",
  nodeId: "node_id",
  name: "name",
  version: "version",
  lastModified: "last_modified",
  state: "state",
  renderPath: "render_path",
  renderVersion: "render_version",
  fetchedAt: "fetched_at",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

const builds = defineTable("builds", {
  id: "id",
  projectId: "project_id",
  gitSha: "git_sha",
  gitBranch: "git_branch",
  isDefault: "is_default",
  authorEmail: "author_email",
  authorName: "author_name",
  message: "message",
  public: "public",
  status: "status",
  snapshotCount: "snapshot_count",
  changedCount: "changed_count",
  approvedCount: "approved_count",
  rejectedCount: "rejected_count",
  affectedOnly: "affected_only",
  baselineSha: "baseline_sha",
  changedFiles: "changed_files",
  affectedImportPaths: "affected_import_paths",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

const captureAttempts = defineTable("capture_attempts", {
  id: "id",
  projectId: "project_id",
  buildId: "build_id",
  attemptNo: "attempt_no",
  status: "status",
  error: "error",
  reqId: "req_id",
  storyCount: "story_count",
  failedCount: "failed_count",
  queuedAt: "queued_at",
  startedAt: "started_at",
  finishedAt: "finished_at",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

const captureShards = defineTable("capture_shards", {
  id: "id",
  projectId: "project_id",
  buildId: "build_id",
  kind: "kind",
  ordinal: "ordinal",
  status: "status",
  attemptId: "attempt_id",
  payload: "payload",
  result: "result",
  error: "error",
  startedAt: "started_at",
  finishedAt: "finished_at",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

const captureJobs = defineTable("capture_jobs", {
  id: "id",
  entry: "entry",
  jobId: "job_id",
  kind: "kind",
  buildId: "build_id",
  shardId: "shard_id",
  attempt: "attempt",
  maxAttempts: "max_attempts",
  status: "status",
  visibleAt: "visible_at",
  owner: "owner",
  payload: "payload",
  cancelRequestedAt: "cancel_requested_at",
  error: "error",
  startedAt: "started_at",
  finishedAt: "finished_at",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

const buildComponents = defineTable("build_components", {
  id: "id",
  projectId: "project_id",
  buildId: "build_id",
  importPath: "import_path",
  title: "title",
  storyCount: "story_count",
  hash: "hash",
  createdAt: "created_at",
});

const buildReviews = defineTable("build_reviews", {
  id: "id",
  buildId: "build_id",
  userId: "user_id",
  verdict: "verdict",
  body: "body",
  createdAt: "created_at",
});

const siteSettings = defineTable("site_settings", {
  id: "id",
  value: "value",
  updatedBy: "updated_by",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

const captureLogs = defineTable("capture_logs", {
  id: "id",
  projectId: "project_id",
  buildId: "build_id",
  attemptId: "attempt_id",
  seq: "seq",
  level: "level",
  message: "message",
  fields: "fields",
  createdAt: "created_at",
});

const snapshots = defineTable("snapshots", {
  durationMs: "duration_ms",
  id: "id",
  projectId: "project_id",
  buildId: "build_id",
  storyId: "story_id",
  storyName: "story_name",
  storyTitle: "story_title",
  storyImportPath: "story_import_path",
  viewportName: "viewport_name",
  viewportWidth: "viewport_width",
  viewportHeight: "viewport_height",
  screenshotPath: "screenshot_path",
  diffPath: "diff_path",
  diffPixels: "diff_pixels",
  diffRatio: "diff_ratio",
  diffPassed: "diff_passed",
  status: "status",
  reviewedBy: "reviewed_by",
  reviewedAt: "reviewed_at",
  designUrl: "design_url",
  infraHash: "infra_hash",
  envChange: "env_change",
  inherited: "inherited",
  baselineId: "baseline_id",
  baselineVersion: "baseline_version",
  mode: "mode",
  browser: "browser",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

const baselines = defineTable("baselines", {
  id: "id",
  projectId: "project_id",
  storyId: "story_id",
  viewportName: "viewport_name",
  branch: "branch",
  snapshotId: "snapshot_id",
  screenshotPath: "screenshot_path",
  infraHash: "infra_hash",
  fingerprint: "fingerprint",
  mode: "mode",
  browser: "browser",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

const comments = defineTable("comments", {
  id: "id",
  projectId: "project_id",
  buildId: "build_id",
  snapshotId: "snapshot_id",
  userId: "user_id",
  body: "body",
  parentId: "parent_id",
  resolved: "resolved",
  createdAt: "created_at",
  updatedAt: "updated_at",
  storyId: "story_id",
});

const labelTypes = defineTable("label_types", {
  id: "id",
  projectId: "project_id",
  key: "key",
  name: "name",
  linkTemplate: "link_template",
  color: "color",
  createdAt: "created_at",
});

const buildLabels = defineTable("build_labels", {
  id: "id",
  projectId: "project_id",
  buildId: "build_id",
  typeKey: "type_key",
  value: "value",
  createdAt: "created_at",
});

const projectLinks = defineTable("project_links", {
  id: "id",
  downstreamId: "downstream_id",
  upstreamId: "upstream_id",
  packageName: "package_name",
  createdAt: "created_at",
});

const buildPackageUsage = defineTable("build_package_usage", {
  id: "id",
  projectId: "project_id",
  buildId: "build_id",
  storyImportPath: "story_import_path",
  packageName: "package_name",
  modulePath: "module_path",
  version: "version",
  createdAt: "created_at",
});

const tokens = defineTable("tokens", {
  id: "id",
  projectId: "project_id",
  name: "name",
  hash: "hash",
  userId: "user_id",
  lastUsedAt: "last_used_at",
  createdAt: "created_at",
});

const webhooks = defineTable("webhooks", {
  id: "id",
  projectId: "project_id",
  url: "url",
  secretEncrypted: "secret_encrypted",
  events: "events",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

const users = defineTable("users", {
  id: "id",
  email: "email",
  name: "name",
  avatarUrl: "avatar_url",
  role: "role",
  lastLoginAt: "last_login_at",
  createdAt: "created_at",
  passwordHash: "password_hash",
  displayNameOverride: "display_name_override",
  authProvider: "auth_provider",
  disabled: "disabled",
});

const userInviteTokens = defineTable("user_invite_tokens", {
  id: "id",
  userId: "user_id",
  tokenHash: "token_hash",
  expiresAt: "expires_at",
  usedAt: "used_at",
  createdAt: "created_at",
});

const projectMembers = defineTable("project_members", {
  id: "id",
  projectId: "project_id",
  userId: "user_id",
  role: "role",
  source: "source",
  createdAt: "created_at",
});

const projectGroupMappings = defineTable("project_group_mappings", {
  id: "id",
  projectId: "project_id",
  groupName: "group_name",
  role: "role",
  createdAt: "created_at",
});

const insights = defineTable("insights", {
  id: "id",
  projectId: "project_id",
  buildId: "build_id",
  kind: "kind",
  windowKey: "window_key",
  inputHash: "input_hash",
  status: "status",
  profile: "profile",
  model: "model",
  promptVersion: "prompt_version",
  verdict: "verdict",
  summary: "summary",
  result: "result",
  errorCode: "error_code",
  createdAt: "created_at",
  startedAt: "started_at",
  finishedAt: "finished_at",
});

const aiUsage = defineTable("ai_usage", {
  id: "id",
  insightId: "insight_id",
  projectId: "project_id",
  profile: "profile",
  task: "task",
  model: "model",
  inputTokens: "input_tokens",
  outputTokens: "output_tokens",
  estimated: "estimated",
  images: "images",
  status: "status",
  createdAt: "created_at",
});

const aiBudgetAlerts = defineTable("ai_budget_alerts", {
  id: "id",
  day: "day",
  threshold: "threshold",
  createdAt: "created_at",
});

const notificationChannels = defineTable("notification_channels", {
  id: "id",
  projectId: "project_id",
  provider: "provider",
  config: "config",
  secretEncrypted: "secret_encrypted",
  events: "events",
  enabled: "enabled",
  lastError: "last_error",
  lastErrorAt: "last_error_at",
  createdAt: "created_at",
  updatedAt: "updated_at",
});

const notificationSubscriptions = defineTable("notification_subscriptions", {
  id: "id",
  projectId: "project_id",
  userId: "user_id",
  events: "events",
  via: "via",
  enabled: "enabled",
  createdAt: "created_at",
});

const contentRefs = defineTable("content_refs", {
  hash: "hash",
  refCount: "ref_count",
  lastSeenAt: "last_seen_at",
  createdAt: "created_at",
});

/** Stub schema bundled into the `Tables` map every fake serves. */
export const fakeSchema: Tables = {
  projects,
  builds,
  captureAttempts,
  captureLogs,
  captureShards,
  captureJobs,
  buildComponents,
  buildReviews,
  siteSettings,
  snapshots,
  baselines,
  comments,
  labelTypes,
  buildLabels,
  projectLinks,
  designLinks,
  designCredentials,
  userConnections,
  designNodes,
  buildPackageUsage,
  tokens,
  webhooks,
  users,
  userInviteTokens,
  projectMembers,
  projectGroupMappings,
  insights,
  aiUsage,
  aiBudgetAlerts,
  notificationChannels,
  notificationSubscriptions,
  contentRefs,
};
