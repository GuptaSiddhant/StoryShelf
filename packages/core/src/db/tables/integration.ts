/**
 * The tables of the built-in integrations (ADR 0049): design links, credentials and nodes, AI
 * insights and usage, and git connections with their repository links, as neutral tables. Not
 * wired into any adapter: the hand-written Drizzle schemas and `ddl.ts` stay authoritative.
 */
import type { GitConnectionProvider, GitRepositoryLinkState } from "../../schema/git-connection.ts";
import { bool, id, int, key, text, timestamp, type NeutralColumn } from "../columns.ts";
import { defineTable, index, uniqueIndex } from "../define-table.ts";

const projectId = (): NeutralColumn<string, true> =>
  id("project_id").notNull().references("projects", "id", "cascade");
const createdAt = (): NeutralColumn<string, true> => timestamp("created_at").notNull();
const updatedAt = (): NeutralColumn<string, true> => timestamp("updated_at").notNull();

/** A design file linked to a project or one of its story files. */
export const designLinks = defineTable(
  "design_links",
  {
    id: id("id").primaryKey(),
    projectId: projectId(),
    importPath: key("import_path", 512),
    label: text("label"),
    url: text("url").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  {
    indexes: [
      index("design_links_project_id_idx", ["projectId"]),
      uniqueIndex("design_links_project_import_path_idx", ["projectId", "importPath"]),
    ],
  },
);

/** A project's encrypted token for one design provider. */
export const designCredentials = defineTable(
  "design_credentials",
  {
    id: id("id").primaryKey(),
    projectId: projectId(),
    provider: key("provider", 64).notNull(),
    tokenEncrypted: text("token_encrypted").notNull(),
    status: key("status", 32).notNull().default("unknown"),
    checkedAt: timestamp("checked_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  { indexes: [uniqueIndex("design_credentials_project_provider_idx", ["projectId", "provider"])] },
);

/** The last fetched state of one design node. */
export const designNodes = defineTable(
  "design_nodes",
  {
    id: id("id").primaryKey(),
    projectId: projectId(),
    provider: key("provider", 64).notNull(),
    viewerId: key("viewer_id", 128).notNull().default(""),
    fileKey: key("file_key", 128).notNull(),
    nodeId: key("node_id", 128).notNull().default(""),
    name: text("name"),
    version: text("version"),
    lastModified: text("last_modified"),
    state: key("state", 32).notNull().default("ok"),
    renderPath: text("render_path"),
    renderVersion: text("render_version"),
    notifiedVersion: text("notified_version"),
    fetchedAt: timestamp("fetched_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  {
    indexes: [
      uniqueIndex("design_nodes_project_file_node_idx", [
        "projectId",
        "provider",
        "viewerId",
        "fileKey",
        "nodeId",
      ]),
    ],
  },
);

/** One AI insight: a build triage or a project health report. */
export const insights = defineTable(
  "insights",
  {
    id: id("id").primaryKey(),
    projectId: projectId(),
    buildId: id("build_id").references("builds", "id", "cascade"),
    kind: key("kind", 32).notNull(),
    windowKey: key("window_key", 64),
    inputHash: key("input_hash", 64).notNull(),
    status: key("status", 32).notNull(),
    profile: text("profile").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    verdict: text("verdict"),
    summary: text("summary"),
    result: text("result"),
    errorCode: text("error_code"),
    createdAt: createdAt(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
  },
  {
    indexes: [
      index("insights_project_build_idx", ["projectId", "buildId"]),
      index("insights_created_at_idx", ["createdAt"]),
      uniqueIndex("insights_triage_unique_idx", ["projectId", "buildId", "kind", "inputHash"]),
      uniqueIndex("insights_health_unique_idx", ["projectId", "kind", "windowKey"]),
    ],
  },
);

/** One AI call and the tokens it used. */
export const aiUsage = defineTable(
  "ai_usage",
  {
    id: id("id").primaryKey(),
    insightId: text("insight_id"),
    projectId: projectId(),
    profile: text("profile").notNull(),
    task: text("task").notNull(),
    model: text("model").notNull(),
    inputTokens: int("input_tokens").notNull().default(0),
    outputTokens: int("output_tokens").notNull().default(0),
    estimated: bool("estimated").notNull().default(false),
    images: int("images").notNull().default(0),
    status: key("status", 32).notNull(),
    createdAt: createdAt(),
  },
  {
    indexes: [
      index("ai_usage_created_at_idx", ["createdAt"]),
      index("ai_usage_project_created_idx", ["projectId", "createdAt"]),
    ],
  },
);

/** A daily AI budget threshold already alerted on. */
export const aiBudgetAlerts = defineTable("ai_budget_alerts", {
  id: id("id").primaryKey(),
  day: text("day").notNull(),
  threshold: int("threshold").notNull(),
  createdAt: createdAt(),
});

/** A site-wide git host connection (ADR 0049). */
export const gitConnections = defineTable("git_connections", {
  id: id("id").primaryKey(),
  provider: key("provider", 32).$type<GitConnectionProvider>().notNull(),
  name: key("name", 255).notNull(),
  apiBase: text("api_base"),
  config: text("config").notNull(),
  secretEncrypted: text("secret_encrypted"),
  createdBy: id("created_by"),
  state: key("state", 32).notNull().default("active"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** A project's link to one repository through a git connection. */
export const gitRepositoryLinks = defineTable(
  "git_repository_links",
  {
    id: id("id").primaryKey(),
    projectId: projectId(),
    connectionId: id("connection_id").notNull().references("git_connections", "id", "no action"),
    host: key("host", 255).notNull(),
    owner: key("owner", 128).notNull(),
    repo: key("repo", 128).notNull(),
    hostRepositoryId: key("host_repository_id", 128),
    prefix: key("prefix", 64).notNull().default(""),
    state: key("state", 32).$type<GitRepositoryLinkState>().notNull().default("pending"),
    reason: text("reason"),
    outputs: text("outputs").notNull().default("{}"),
    installationId: id("installation_id"),
    requestedBy: id("requested_by"),
    approvedBy: id("approved_by"),
    approvedAt: timestamp("approved_at"),
    lastDeliveredAt: timestamp("last_delivered_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  {
    indexes: [
      uniqueIndex("git_repository_links_repository_idx", ["host", "owner", "repo", "prefix"]),
      index("git_repository_links_project_id_idx", ["projectId"]),
      index("git_repository_links_connection_id_idx", ["connectionId"]),
    ],
  },
);
