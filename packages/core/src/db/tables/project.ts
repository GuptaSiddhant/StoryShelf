/**
 * `projects` and the tables that only hang off it (members, group mappings, links), as neutral
 * tables. Not wired into any adapter: the hand-written Drizzle schemas and `ddl.ts` stay
 * authoritative.
 */
import type { ProjectRole } from "../../types.ts";
import { bool, double, id, int, key, text, timestamp } from "../columns.ts";
import { defineTable, uniqueIndex } from "../define-table.ts";

export const projects = defineTable("projects", {
  id: id("id").primaryKey(),
  name: text("name").notNull(),
  slug: key("slug", 255).notNull().unique(),
  gitRepository: text("git_repository"),
  gitDefaultBranch: key("git_default_branch", 255).notNull().default("main"),
  pixelThreshold: double("pixel_threshold").notNull().default(0.1),
  maxDiffRatio: double("max_diff_ratio").notNull().default(0.01),
  publicBranchRegex: text("public_branch_regex"),
  storybookMeta: text("storybook_meta"),
  executePlay: bool("execute_play").notNull().default(false),
  playTimeoutMs: int("play_timeout_ms").notNull().default(10_000),
  runA11y: bool("run_a11y").notNull().default(true),
  runTests: bool("run_tests").notNull().default(false),
  switchStories: bool("switch_stories").notNull().default(false),
  detectUnstable: bool("detect_unstable").notNull().default(true),
  browser: key("browser", 64).notNull().default("chromium"),
  viewports: text("viewports"),
  browsers: text("browsers"),
  modesAllowlist: text("modes_allowlist"),
  automigrate: bool("automigrate").notNull().default(false),
  aiProfile: text("ai_profile"),
  reviewEnabled: bool("review_enabled").notNull().default(true),
  reviewApprovals: int("review_approvals").notNull().default(1),
  requireVerifiedDefault: bool("require_verified_default").notNull().default(true),
  storybookUrlTtlSeconds: int("storybook_url_ttl_seconds"),
  componentOwners: text("component_owners"),
  cancelSuperseded: bool("cancel_superseded").notNull().default(true),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const projectMembers = defineTable(
  "project_members",
  {
    id: id("id").primaryKey(),
    projectId: id("project_id").notNull().references("projects", "id", "cascade"),
    userId: id("user_id").notNull().references("users", "id", "cascade"),
    role: key("role", 32).$type<ProjectRole>().notNull().default("viewer"),
    /** Provenance: `manual` grants vs `oidc:<group>` synced grants. */
    source: key("source", 32).notNull().default("manual"),
    createdAt: timestamp("created_at").notNull(),
  },
  { indexes: [uniqueIndex("project_members_project_user_idx", ["projectId", "userId"])] },
);

export const projectGroupMappings = defineTable(
  "project_group_mappings",
  {
    id: id("id").primaryKey(),
    projectId: id("project_id").notNull().references("projects", "id", "cascade"),
    groupName: key("group_name", 255).notNull(),
    role: key("role", 32).$type<ProjectRole>().notNull().default("viewer"),
    createdAt: timestamp("created_at").notNull(),
  },
  {
    indexes: [uniqueIndex("project_group_mappings_project_group_idx", ["projectId", "groupName"])],
  },
);

export const projectLinks = defineTable(
  "project_links",
  {
    id: id("id").primaryKey(),
    downstreamId: id("downstream_id").notNull().references("projects", "id", "cascade"),
    upstreamId: id("upstream_id").notNull().references("projects", "id", "cascade"),
    packageName: key("package_name", 255).notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  {
    indexes: [uniqueIndex("project_links_downstream_package_idx", ["downstreamId", "packageName"])],
  },
);
