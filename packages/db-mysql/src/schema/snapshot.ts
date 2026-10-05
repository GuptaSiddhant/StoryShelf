import type { SnapshotStatus } from "@storyshelf/core/types";
import {
  boolean,
  double,
  index,
  int,
  mysqlTable,
  text,
  datetime,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { builds } from "./build.ts";
import { projects } from "./project.ts";

/** Narrow `snapshots` table definition. */
export const snapshots = mysqlTable(
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
    viewportWidth: int("viewport_width").notNull().default(1280),
    viewportHeight: int("viewport_height").notNull().default(720),
    screenshotPath: text("screenshot_path").notNull(),
    diffPath: text("diff_path"),
    diffPixels: int("diff_pixels"),
    diffRatio: double("diff_ratio"),
    diffPassed: boolean("diff_passed"),
    status: text("status").$type<SnapshotStatus>().notNull().default("pending"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: datetime("reviewed_at", { mode: "string", fsp: 3 }),
    infraHash: text("infra_hash"),
    inherited: boolean("inherited").notNull().default(false),
    baselineId: text("baseline_id"),
    baselineVersion: text("baseline_version"),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull(),
  },
  (t) => [
    uniqueIndex("snapshots_build_story_viewport_idx").on(t.buildId, t.storyId, t.viewportName),
    index("snapshots_build_id_idx").on(t.buildId),
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
  inherited: boolean;
  baselineId: string | null;
  baselineVersion: string | null;
  createdAt: string;
  updatedAt: string;
}
