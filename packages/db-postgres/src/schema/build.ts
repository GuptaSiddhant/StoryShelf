import type { BuildStatus } from "@storyshelf/core/types";
import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { projects } from "./project.ts";

/** Narrow `builds` table definition. */
export const builds = pgTable(
  "builds",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    gitSha: text("git_sha").notNull(),
    gitBranch: text("git_branch").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    authorEmail: text("author_email"),
    authorName: text("author_name"),
    message: text("message"),
    public: boolean("public").notNull().default(false),
    status: text("status").$type<BuildStatus>().notNull().default("pending"),
    retentionState: text("retention_state").notNull().default("available"),
    snapshotCount: integer("snapshot_count").notNull().default(0),
    changedCount: integer("changed_count").notNull().default(0),
    approvedCount: integer("approved_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0),
    /** Snapshots inherited from the baseline without rendering (affected capture). */
    inheritedCount: integer("inherited_count").notNull().default(0),
    affectedOnly: boolean("affected_only").notNull().default(true),
    baselineSha: text("baseline_sha"),
    changedFiles: text("changed_files"),
    affectedImportPaths: text("affected_import_paths"),
    testResults: text("test_results"),
    captureGeneration: integer("capture_generation").notNull().default(0),
    reviewCycle: integer("review_cycle").notNull().default(0),
    reviewRequestedCycle: integer("review_requested_cycle"),
    captureJobId: text("capture_job_id"),
    manifestSha256: text("manifest_sha256"),
    supersededByBuildId: text("superseded_by_build_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [
    index("builds_project_gitsha_idx").on(t.projectId, t.gitSha),
    index("builds_project_created_idx").on(t.projectId, t.createdAt),
    index("builds_project_branch_created_idx").on(t.projectId, t.gitBranch, t.createdAt),
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
  retentionState: string;
  snapshotCount: number;
  changedCount: number;
  approvedCount: number;
  rejectedCount: number;
  inheritedCount: number;
  affectedOnly: boolean;
  baselineSha: string | null;
  changedFiles: string | null;
  affectedImportPaths: string | null;
  testResults: string | null;
  captureGeneration: number;
  reviewCycle: number;
  reviewRequestedCycle: number | null;
  captureJobId: string | null;
  manifestSha256: string | null;
  supersededByBuildId: string | null;
  createdAt: string;
  updatedAt: string;
}
