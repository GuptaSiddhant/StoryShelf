import type { SnapshotStatus } from "@storyshelf/core/types";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { builds } from "./build.ts";
import { projects } from "./project.ts";

/** Narrow `snapshots` table definition. */
export const snapshots = pgTable(
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
    diffRatio: doublePrecision("diff_ratio"),
    diffPassed: boolean("diff_passed"),
    status: text("status").$type<SnapshotStatus>().notNull().default("pending"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
    infraHash: text("infra_hash"),
    envChange: text("env_change"),
    inherited: boolean("inherited").notNull().default(false),
    baselineId: text("baseline_id"),
    baselineVersion: text("baseline_version"),
    mode: text("mode"),
    browser: text("browser").notNull().default("chromium"),
    durationMs: integer("duration_ms"),
    a11yViolations: text("a11y_violations"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
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
  mode?: string | null;
  browser?: string;
  durationMs: number | null;
  a11yViolations: string | null;
  createdAt: string;
  updatedAt: string;
}
