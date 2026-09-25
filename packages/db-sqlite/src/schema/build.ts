import type { BuildStatus } from "@storyshelf/core/types";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { projects } from "./project.ts";

/** Narrow `builds` table definition. */
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
    affectedOnly: integer("affected_only", { mode: "boolean" }).notNull().default(true),
    baselineSha: text("baseline_sha"),
    changedFiles: text("changed_files"),
    affectedImportPaths: text("affected_import_paths"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("builds_project_gitsha_idx").on(t.projectId, t.gitSha),
    index("builds_git_branch_idx").on(t.gitBranch),
  ],
);

/** A build row. */
export interface Build {
  id: string;
  projectId: string;
  gitSha: string;
  gitBranch: string;
  isDefault: boolean;
  authorEmail: string | null;
  authorName: string | null;
  message: string | null;
  public: boolean;
  status: BuildStatus;
  snapshotCount: number;
  changedCount: number;
  approvedCount: number;
  rejectedCount: number;
  affectedOnly: boolean;
  baselineSha: string | null;
  changedFiles: string | null;
  affectedImportPaths: string | null;
  createdAt: string;
  updatedAt: string;
}
