import type { SnapshotStatus } from "@storyshelf/core/types";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { builds } from "./build.ts";
import { projects } from "./project.ts";

/** Narrow `snapshots` table definition. */
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
    designUrl: text("design_url"),
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
    infraHash: text("infra_hash"),
    envChange: text("env_change"),
    inherited: integer("inherited", { mode: "boolean" }).notNull().default(false),
    baselineId: text("baseline_id"),
    baselineVersion: text("baseline_version"),
    mode: text("mode"),
    browser: text("browser").notNull().default("chromium"),
    durationMs: integer("duration_ms"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("snapshots_build_story_mode_browser_idx").on(
      t.buildId,
      t.storyId,
      t.viewportName,
      t.browser,
    ),
    index("snapshots_build_id_idx").on(t.buildId),
    index("snapshots_project_import_path_idx").on(t.projectId, t.storyImportPath),
  ],
);

/** A snapshot row. */
export interface Snapshot {
  id: string;
  projectId: string;
  buildId: string;
  storyId: string;
  storyName: string;
  storyTitle: string;
  storyImportPath: string | null;
  designUrl: string | null;
  viewportName: string;
  viewportWidth: number;
  viewportHeight: number;
  screenshotPath: string;
  diffPath: string | null;
  diffPixels: number | null;
  diffRatio: number | null;
  diffPassed: boolean | null;
  status: SnapshotStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  infraHash: string | null;
  envChange: string | null;
  inherited: boolean;
  baselineId: string | null;
  baselineVersion: string | null;
  mode: string | null;
  browser: string;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
}
