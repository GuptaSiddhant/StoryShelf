import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import type { BuildStatus, ProjectRole, SiteRole, SnapshotStatus } from "./types.ts";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  gitRepository: text("git_repository"),
  gitDefaultBranch: text("git_default_branch").notNull().default("main"),
  pixelThreshold: real("pixel_threshold").notNull().default(0.1),
  maxDiffRatio: real("max_diff_ratio").notNull().default(0.01),
  publicBranchRegex: text("public_branch_regex"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const projectStatusConfigs = sqliteTable("project_status_configs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  config: text("config").notNull(),
  tokenEncrypted: text("token_encrypted").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const builds = sqliteTable(
  "builds",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    gitSha: text("git_sha").notNull(),
    gitBranch: text("git_branch").notNull(),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    authorEmail: text("author_email"),
    authorName: text("author_name"),
    message: text("message"),
    public: integer("public", { mode: "boolean" }).notNull().default(false),
    status: text("status").$type<BuildStatus>().notNull().default("pending"),
    snapshotCount: integer("snapshot_count").notNull().default(0),
    changedCount: integer("changed_count").notNull().default(0),
    approvedCount: integer("approved_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("builds_project_gitsha_idx").on(t.projectId, t.gitSha)],
);

export const snapshots = sqliteTable(
  "snapshots",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    buildId: text("build_id")
      .notNull()
      .references(() => builds.id, { onDelete: "cascade" }),
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
    status: text("status").$type<SnapshotStatus>().notNull().default("pending"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: text("reviewed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("snapshots_build_story_viewport_idx").on(t.buildId, t.storyId, t.viewportName)],
);

export const baselines = sqliteTable(
  "baselines",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    storyId: text("story_id").notNull(),
    viewportName: text("viewport_name").notNull().default("desktop"),
    branch: text("branch").notNull(),
    snapshotId: text("snapshot_id"),
    screenshotPath: text("screenshot_path").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("baselines_project_story_viewport_branch_idx").on(t.projectId, t.storyId, t.viewportName, t.branch)],
);

export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  buildId: text("build_id")
    .notNull()
    .references(() => builds.id, { onDelete: "cascade" }),
  snapshotId: text("snapshot_id").references(() => snapshots.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  parentId: text("parent_id"),
  resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const labelTypes = sqliteTable(
  "label_types",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    linkTemplate: text("link_template"),
    color: text("color"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("label_types_project_key_idx").on(t.projectId, t.key)],
);

export const buildLabels = sqliteTable(
  "build_labels",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    buildId: text("build_id")
      .notNull()
      .references(() => builds.id, { onDelete: "cascade" }),
    typeKey: text("type_key").notNull(),
    value: text("value").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("build_labels_build_type_value_idx").on(t.buildId, t.typeKey, t.value)],
);

export const tokens = sqliteTable("tokens", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  hash: text("hash").notNull(),
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at").notNull(),
});

export const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: text("events"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  role: text("role").$type<SiteRole>().notNull().default("member"),
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at").notNull(),
});

export const projectMembers = sqliteTable(
  "project_members",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<ProjectRole>().notNull().default("viewer"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("project_members_project_user_idx").on(t.projectId, t.userId)],
);

export const schema = {
  projects,
  projectStatusConfigs,
  builds,
  snapshots,
  baselines,
  comments,
  labelTypes,
  buildLabels,
  tokens,
  webhooks,
  users,
  projectMembers,
};

export type Schema = typeof schema;

export type Project = typeof projects.$inferSelect;
export type ProjectStatusConfig = typeof projectStatusConfigs.$inferSelect;
export type Build = typeof builds.$inferSelect;
export type Snapshot = typeof snapshots.$inferSelect;
export type Baseline = typeof baselines.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type LabelType = typeof labelTypes.$inferSelect;
export type BuildLabel = typeof buildLabels.$inferSelect;
export type Token = typeof tokens.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type User = typeof users.$inferSelect;
export type ProjectMember = typeof projectMembers.$inferSelect;
