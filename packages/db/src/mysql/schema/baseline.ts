import { index, mysqlTable, text, uniqueIndex } from "drizzle-orm/mysql-core";
import { datetime } from "./datetime.ts";
import { projects } from "./project.ts";

/** Narrow `baselines` table definition. */
export const baselines = mysqlTable(
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
    sourceBuildId: text("source_build_id"),
    screenshotPath: text("screenshot_path").notNull(),
    infraHash: text("infra_hash"),
    fingerprint: text("fingerprint"),
    mode: text("mode"),
    browser: text("browser").notNull().default("chromium"),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull(),
  },
  (t) => [
    uniqueIndex("baselines_project_story_mode_browser_branch_idx").on(
      t.projectId,
      t.storyId,
      t.viewportName,
      t.browser,
      t.branch,
    ),
    index("baselines_project_story_idx").on(t.projectId, t.storyId),
  ],
);

/** A baseline row. */
export interface Baseline {
  id: string;
  projectId: string;
  storyId: string;
  viewportName: string;
  branch: string;
  snapshotId: string | null;
  sourceBuildId: string | null;
  screenshotPath: string;
  infraHash: string | null;
  fingerprint: string | null;
  mode?: string | null;
  browser?: string;
  createdAt: string;
  updatedAt: string;
}
