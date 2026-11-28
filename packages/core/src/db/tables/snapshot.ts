/**
 * Captured snapshots, the baselines they are compared against, and the review comments on
 * them, as neutral tables. Not wired into any adapter: the hand-written Drizzle schemas and
 * `ddl.ts` stay authoritative.
 */
import type { SnapshotStatus } from "../../types.ts";
import { bool, double, id, int, key, text, timestamp, type NeutralColumn } from "../columns.ts";
import { defineTable, index, uniqueIndex } from "../define-table.ts";

const projectId = (): NeutralColumn<string, true> =>
  id("project_id").notNull().references("projects", "id", "cascade");
const buildId = (): NeutralColumn<string, true> =>
  id("build_id").notNull().references("builds", "id", "cascade");
const storyId = (): NeutralColumn<string, true> => key("story_id", 255).notNull();
const viewportName = (): NeutralColumn<string, true, true> =>
  key("viewport_name", 64).notNull().default("desktop");
const browser = (): NeutralColumn<string, true, true> =>
  key("browser", 64).notNull().default("chromium");

/** One rendered story at one viewport and browser in one build. */
export const snapshots = defineTable(
  "snapshots",
  {
    id: id("id").primaryKey(),
    projectId: projectId(),
    buildId: buildId(),
    storyId: storyId(),
    storyName: text("story_name").notNull(),
    storyTitle: text("story_title").notNull(),
    storyImportPath: key("story_import_path", 512),
    designUrl: text("design_url"),
    viewportName: viewportName(),
    viewportWidth: int("viewport_width").notNull().default(1280),
    viewportHeight: int("viewport_height").notNull().default(720),
    screenshotPath: text("screenshot_path").notNull(),
    diffPath: text("diff_path"),
    diffPixels: int("diff_pixels"),
    diffRatio: double("diff_ratio"),
    diffPassed: bool("diff_passed"),
    status: key("status", 32).$type<SnapshotStatus>().notNull().default("pending"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at"),
    infraHash: text("infra_hash"),
    envChange: text("env_change"),
    inherited: bool("inherited").notNull().default(false),
    baselineId: id("baseline_id"),
    baselineVersion: text("baseline_version"),
    sourceBuildId: text("source_build_id"),
    comparisonImagePath: text("comparison_image_path"),
    comparisonMetadata: text("comparison_metadata"),
    mode: key("mode", 64),
    browser: browser(),
    durationMs: int("duration_ms"),
    a11yViolations: text("a11y_violations"),
    unstable: bool("unstable"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  {
    indexes: [
      uniqueIndex("snapshots_build_story_mode_browser_idx", [
        "buildId",
        "storyId",
        "viewportName",
        "browser",
      ]),
      index("snapshots_build_id_idx", ["buildId"]),
      index("snapshots_project_import_path_idx", ["projectId", "storyImportPath"]),
      index("snapshots_project_story_mode_idx", [
        "projectId",
        "storyId",
        "viewportName",
        "browser",
      ]),
    ],
  },
);

/** The accepted image of a story per branch, viewport and browser (ADR 0039). */
export const baselines = defineTable(
  "baselines",
  {
    id: id("id").primaryKey(),
    projectId: projectId(),
    storyId: storyId(),
    viewportName: viewportName(),
    branch: key("branch", 255).notNull(),
    snapshotId: id("snapshot_id"),
    sourceBuildId: text("source_build_id"),
    screenshotPath: text("screenshot_path").notNull(),
    infraHash: text("infra_hash"),
    fingerprint: text("fingerprint"),
    mode: key("mode", 64),
    browser: browser(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  {
    indexes: [
      uniqueIndex("baselines_project_story_mode_browser_branch_idx", [
        "projectId",
        "storyId",
        "viewportName",
        "browser",
        "branch",
      ]),
      index("baselines_project_story_idx", ["projectId", "storyId"]),
    ],
  },
);

/** A comment anchored to exactly one of a build, a story or a snapshot. */
export const comments = defineTable(
  "comments",
  {
    id: id("id").primaryKey(),
    projectId: projectId(),
    buildId: buildId(),
    snapshotId: id("snapshot_id").references("snapshots", "id", "cascade"),
    userId: id("user_id").references("users", "id", "cascade"),
    body: text("body").notNull(),
    parentId: text("parent_id"),
    resolved: bool("resolved").notNull().default(false),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    storyId: text("story_id"),
    mentions: text("mentions"),
    kind: key("kind", 32).notNull().default("comment"),
    resolvedAt: timestamp("resolved_at"),
    resolvedBy: id("resolved_by"),
  },
  { indexes: [index("comments_build_id_idx", ["buildId"])] },
);
