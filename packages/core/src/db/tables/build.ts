/**
 * `builds` and the ADR 0039 lifecycle tables that hang off it, as neutral tables (spike #800).
 * Not wired into any adapter: the hand-written Drizzle schemas and `ddl.ts` stay authoritative.
 */
import type { BuildStatus } from "../../types.ts";
import {
  bigint,
  bool,
  enumOf,
  id,
  int,
  key,
  text,
  timestamp,
  type NeutralColumn,
} from "../columns.ts";
import { defineTable, index, uniqueIndex, type CheckSpec } from "../define-table.ts";

const projectId = (): NeutralColumn<string, true> =>
  id("project_id").notNull().references("projects", "id", "cascade");

export const builds = defineTable(
  "builds",
  {
    id: id("id").primaryKey(),
    projectId: projectId(),
    gitSha: key("git_sha", 64).notNull(),
    gitBranch: key("git_branch", 255).notNull(),
    isDefault: bool("is_default").notNull().default(false),
    branchVerified: key("branch_verified", 16),
    authorEmail: text("author_email"),
    authorName: text("author_name"),
    message: text("message"),
    public: bool("public").notNull().default(false),
    status: key("status", 32).$type<BuildStatus>().notNull().default("pending"),
    retentionState: key("retention_state", 16).notNull().default("available"),
    snapshotCount: int("snapshot_count").notNull().default(0),
    changedCount: int("changed_count").notNull().default(0),
    approvedCount: int("approved_count").notNull().default(0),
    rejectedCount: int("rejected_count").notNull().default(0),
    inheritedCount: int("inherited_count").notNull().default(0),
    affectedOnly: bool("affected_only").notNull().default(true),
    baselineSha: text("baseline_sha"),
    changedFiles: text("changed_files"),
    affectedImportPaths: text("affected_import_paths"),
    testResults: text("test_results"),
    captureGeneration: int("capture_generation").notNull().default(0),
    reviewCycle: int("review_cycle").notNull().default(0),
    reviewRequestedCycle: int("review_requested_cycle"),
    captureJobId: id("capture_job_id", 26),
    skippedFromBuildId: id("skipped_from_build_id", 26),
    supersededByBuildId: id("superseded_by_build_id", 26),
    idempotencyKey: key("idempotency_key", 191),
    manifestSha256: key("manifest_sha256", 64),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  {
    indexes: [
      index("builds_project_gitsha_idx", ["projectId", "gitSha"]),
      index("builds_skipped_from_idx", ["skippedFromBuildId"]),
      uniqueIndex("builds_project_idempotency_idx", ["projectId", "idempotencyKey"]),
      index("builds_project_created_idx", ["projectId", "createdAt"]),
      index("builds_project_branch_created_idx", ["projectId", "gitBranch", "createdAt"]),
    ],
  },
);

const OWNER_TYPES = ["baseline", "investigation"] as const;
const ownerTypeCheck = (table: string): CheckSpec => ({
  name: `${table}_owner_type_check`,
  sql: "owner_type IN ('baseline', 'investigation')",
});

export const buildReferences = defineTable(
  "build_references",
  {
    projectId: projectId(),
    ownerType: enumOf("owner_type", OWNER_TYPES).notNull(),
    ownerId: id("owner_id").notNull(),
    buildId: id("build_id").notNull().references("builds", "id", "restrict"),
  },
  {
    primaryKey: { columns: ["projectId", "ownerType", "ownerId", "buildId"] },
    indexes: [index("build_references_build_idx", ["buildId"])],
    checks: [ownerTypeCheck("build_references")],
  },
);

export const buildReferenceGenerations = defineTable(
  "build_reference_generations",
  {
    projectId: projectId(),
    ownerType: enumOf("owner_type", OWNER_TYPES).notNull(),
    ownerId: id("owner_id").notNull(),
    generation: bigint("generation").notNull(),
  },
  {
    primaryKey: { columns: ["projectId", "ownerType", "ownerId"] },
    checks: [
      ownerTypeCheck("build_reference_generations"),
      { name: "build_reference_generations_generation_check", sql: "generation >= 0" },
    ],
  },
);

export const buildDeletions = defineTable("build_deletions", {
  buildId: id("build_id").primaryKey().references("builds", "id", "cascade"),
  projectId: projectId(),
  contentReleasedAt: timestamp("content_released_at"),
  storageDeletedAt: timestamp("storage_deleted_at"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const buildContentReleases = defineTable(
  "build_content_releases",
  {
    buildId: id("build_id").notNull().references("builds", "id", "cascade"),
    contentHash: key("content_hash", 128).notNull(),
    releasedAt: timestamp("released_at").notNull(),
  },
  { primaryKey: { columns: ["buildId", "contentHash"] } },
);
