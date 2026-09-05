import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { BuildStatus } from "../types.ts";
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
  createdAt: string;
  updatedAt: string;
}
