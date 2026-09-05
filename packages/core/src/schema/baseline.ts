import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { projects } from "./project.ts";

/** Narrow `baselines` table definition. */
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
  (t) => [
    uniqueIndex("baselines_project_story_viewport_branch_idx").on(
      t.projectId,
      t.storyId,
      t.viewportName,
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
  screenshotPath: string;
  createdAt: string;
  updatedAt: string;
}
