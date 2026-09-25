import type { SQL, Table } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { DatabaseAdapter, ListOptions } from "../db/database.ts";
import type { Tables } from "../db/tables.ts";
import { orderRows, whereMatches } from "./sql-chunks.ts";

// In-memory tables matching the real schema's property->column mapping.
// No foreign keys, just column names for whereMatches/orderRows.
const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  gitRepository: text("git_repository"),
  gitDefaultBranch: text("git_default_branch").notNull().default("main"),
  pixelThreshold: real("pixel_threshold").notNull().default(0.1),
  maxDiffRatio: real("max_diff_ratio").notNull().default(0.01),
  publicBranchRegex: text("public_branch_regex"),
  storybookMeta: text("storybook_meta"),
  executePlay: integer("execute_play", { mode: "boolean" }).notNull().default(false),
  playTimeoutMs: integer("play_timeout_ms").notNull().default(10_000),
  runA11y: integer("run_a11y", { mode: "boolean" }).notNull().default(false),
  browser: text("browser").notNull().default("chromium"),
  viewports: text("viewports"),
  automigrate: integer("automigrate", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

const projectStatusConfigs = sqliteTable("project_status_configs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  provider: text("provider").notNull(),
  config: text("config").notNull(),
  tokenEncrypted: text("token_encrypted").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

const builds = sqliteTable("builds", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  gitSha: text("git_sha").notNull(),
  gitBranch: text("git_branch").notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  authorEmail: text("author_email"),
  authorName: text("author_name"),
  message: text("message"),
  public: integer("public", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("pending"),
  snapshotCount: integer("snapshot_count").notNull().default(0),
  changedCount: integer("changed_count").notNull().default(0),
  approvedCount: integer("approved_count").notNull().default(0),
  rejectedCount: integer("rejected_count").notNull().default(0),
  affectedOnly: integer("affected_only", { mode: "boolean" }).notNull().default(true),
  baselineSha: text("baseline_sha"),
  changedFiles: text("changed_files"),
  affectedImportPaths: text("affected_import_paths"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

const captureAttempts = sqliteTable("capture_attempts", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  buildId: text("build_id").notNull(),
  attemptNo: integer("attempt_no").notNull(),
  status: text("status").notNull().default("queued"),
  error: text("error"),
  reqId: text("req_id"),
  storyCount: integer("story_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  queuedAt: text("queued_at").notNull(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

const captureLogs = sqliteTable("capture_logs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  buildId: text("build_id").notNull(),
  attemptId: text("attempt_id").notNull(),
  seq: integer("seq").notNull(),
  level: text("level").notNull().default("info"),
  message: text("message").notNull(),
  fields: text("fields"),
  createdAt: text("created_at").notNull(),
});

const snapshots = sqliteTable("snapshots", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  buildId: text("build_id").notNull(),
  storyId: text("story_id").notNull(),
  storyName: text("story_name").notNull(),
  storyTitle: text("story_title").notNull(),
  storyImportPath: text("story_import_path"),
  viewportName: text("viewport_name").notNull().default("desktop"),
  viewportWidth: integer("viewport_width").notNull().default(1280),
  viewportHeight: integer("viewport_height").notNull().default(720),
  screenshotPath: text("screenshot_path").notNull(),
  diffPath: text("diff_path"),
  diffPixels: integer("diff_pixels"),
  diffRatio: real("diff_ratio"),
  diffPassed: integer("diff_passed", { mode: "boolean" }),
  status: text("status").notNull().default("pending"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: text("reviewed_at"),
  infraHash: text("infra_hash"),
  inherited: integer("inherited", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

const baselines = sqliteTable("baselines", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  storyId: text("story_id").notNull(),
  viewportName: text("viewport_name").notNull().default("desktop"),
  branch: text("branch").notNull(),
  snapshotId: text("snapshot_id"),
  screenshotPath: text("screenshot_path").notNull(),
  infraHash: text("infra_hash"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  buildId: text("build_id").notNull(),
  snapshotId: text("snapshot_id"),
  userId: text("user_id"),
  body: text("body").notNull(),
  parentId: text("parent_id"),
  resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

const labelTypes = sqliteTable("label_types", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  linkTemplate: text("link_template"),
  color: text("color"),
  createdAt: text("created_at").notNull(),
});

const buildLabels = sqliteTable("build_labels", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  buildId: text("build_id").notNull(),
  typeKey: text("type_key").notNull(),
  value: text("value").notNull(),
  createdAt: text("created_at").notNull(),
});

const tokens = sqliteTable("tokens", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  name: text("name").notNull(),
  hash: text("hash").notNull(),
  userId: text("user_id"),
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at").notNull(),
});

const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  url: text("url").notNull(),
  secretEncrypted: text("secret_encrypted").notNull(),
  events: text("events"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  role: text("role").notNull().default("member"),
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at").notNull(),
});

const projectMembers = sqliteTable("project_members", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role").notNull().default("viewer"),
  source: text("source").notNull().default("manual"),
  createdAt: text("created_at").notNull(),
});

const projectGroupMappings = sqliteTable("project_group_mappings", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  groupName: text("group_name").notNull(),
  role: text("role").notNull().default("viewer"),
  createdAt: text("created_at").notNull(),
});

const contentRefs = sqliteTable("content_refs", {
  hash: text("hash").primaryKey(),
  refCount: integer("ref_count").notNull().default(1),
  lastSeenAt: text("last_seen_at").notNull(),
  createdAt: text("created_at").notNull(),
});

const fakeSchema: Tables = {
  projects,
  projectStatusConfigs,
  builds,
  captureAttempts,
  captureLogs,
  snapshots,
  baselines,
  comments,
  labelTypes,
  buildLabels,
  tokens,
  webhooks,
  users,
  projectMembers,
  projectGroupMappings,
  contentRefs,
};

function withoutUndefined(values: unknown): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values as Record<string, unknown>).filter((pair) => pair[1] !== undefined),
  );
}

// The in-memory fake back-fills Drizzle's inferred row types from raw maps
// Without a driver, so the casts and await-free `async` methods are unavoidable.
/* eslint-disable require-await, no-unnecessary-type-assertion, no-unnecessary-type-parameters, non-nullable-type-assertion-style */
/** Create an in-memory database adapter for capture pipeline tests. */
export function makeDatabase(): { db: DatabaseAdapter } {
  const store = new Map<Table, Map<string, unknown>>();

  const rowsOf = (table: Table): Map<string, unknown> => {
    let rowMap = store.get(table);
    if (!rowMap) {
      rowMap = new Map();
      store.set(table, rowMap);
    }
    return rowMap;
  };

  const insertRow = async <T extends Table>(
    table: T,
    values: T["$inferInsert"],
  ): Promise<T["$inferSelect"]> => {
    const row = withoutUndefined(values);
    const key = (row["id"] ?? row["hash"]) as string;
    rowsOf(table).set(key, row);
    return row as T["$inferSelect"];
  };

  const updateRow = async <T extends Table>(
    table: T,
    id: string,
    values: Partial<T["$inferInsert"]>,
  ): Promise<T["$inferSelect"]> => {
    const current = rowsOf(table).get(id) as Record<string, unknown> | undefined;
    if (current === undefined) {
      throw new Error("row not found");
    }
    const merged = withoutUndefined({ ...current, ...values });
    rowsOf(table).set(id, merged);
    return merged as T["$inferSelect"];
  };

  const getRow = async <T extends Table>(
    table: T,
    id: string,
  ): Promise<T["$inferSelect"] | null> => {
    const found = rowsOf(table).get(id);
    if (found === undefined) {
      return null;
    }
    return found as T["$inferSelect"];
  };

  const listRows = async <T extends Table>(
    table: T,
    opts: ListOptions = {},
  ): Promise<T["$inferSelect"][]> => {
    let current = [...rowsOf(table).values()];
    if (opts.where) {
      const { where } = opts;
      current = current.filter((row) => whereMatches(where, row as Record<string, unknown>, table));
    }
    if (opts.orderBy) {
      current = orderRows(current, opts.orderBy, table);
    }
    if (opts.limit !== undefined) {
      current = current.slice(0, opts.limit);
    }
    return current as T["$inferSelect"][];
  };

  const countRows = async (table: Table, where?: SQL): Promise<number> => {
    const matching = await listRows(table, where ? { where } : {});
    return matching.length;
  };

  const db: DatabaseAdapter = {
    metadata: { name: "Fake Database", version: "0.0.0", kind: "memory", category: "database" },
    tables: fakeSchema,
    insert: insertRow,
    update: updateRow,
    get: getRow,
    remove: async (table, id) => {
      rowsOf(table).delete(id);
    },
    list: listRows,
    count: countRows,
    all: async (_query: SQL) => {
      const results: Record<string, unknown>[] = [];
      for (const rows of store.values()) {
        for (const row of rows.values()) {
          results.push(row as Record<string, unknown>);
        }
      }
      return results as never[];
    },
  };
  return { db };
}
/* eslint-enable require-await, no-unnecessary-type-assertion, no-unnecessary-type-parameters, non-nullable-type-assertion-style */
