/**
 * What a build contains and how it was reviewed, as neutral tables: its components, the packages
 * its stories import, its verdicts, and the content-addressed files it uses (ADR 0039).
 */
import type { ReviewVerdict } from "../../types.ts";
import { bigint, id, int, key, text, timestamp, type NeutralColumn } from "../columns.ts";
import { defineTable, index } from "../define-table.ts";

const projectId = (): NeutralColumn<string, true> =>
  id("project_id").notNull().references("projects", "id", "cascade");
const buildId = (): NeutralColumn<string, true> =>
  id("build_id").notNull().references("builds", "id", "cascade");

/** The verdicts on a build; the newest row counts (ADR 0013). */
export const buildReviews = defineTable(
  "build_reviews",
  {
    id: id("id").primaryKey(),
    buildId: buildId(),
    userId: id("user_id").references("users", "id", "cascade"),
    verdict: text("verdict").$type<ReviewVerdict>().notNull(),
    body: text("body"),
    createdAt: timestamp("created_at").notNull(),
  },
  { indexes: [index("build_reviews_build_id_idx", ["buildId"])] },
);

/** One row per component (story file) of a build. */
export const buildComponents = defineTable(
  "build_components",
  {
    id: id("id").primaryKey(),
    projectId: projectId(),
    buildId: buildId(),
    importPath: key("import_path", 512).notNull(),
    title: text("title").notNull(),
    storyCount: int("story_count").notNull().default(0),
    hash: text("hash").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  {
    indexes: [
      index("build_components_build_id_idx", ["buildId"]),
      index("build_components_project_import_path_idx", ["projectId", "importPath"]),
    ],
  },
);

/** The packages each story file of a build imports. */
export const buildPackageUsage = defineTable(
  "build_package_usage",
  {
    id: id("id").primaryKey(),
    projectId: projectId(),
    buildId: buildId(),
    storyImportPath: text("story_import_path").notNull(),
    packageName: text("package_name").notNull(),
    modulePath: text("module_path").notNull(),
    version: text("version"),
    createdAt: timestamp("created_at").notNull(),
  },
  { indexes: [index("build_package_usage_build_id_idx", ["buildId"])] },
);

/**
 * The content-addressed files a build uses. No foreign keys: a row outlives its build until the
 * collector releases it.
 */
export const contentUses = defineTable(
  "content_uses",
  {
    buildId: id("build_id").notNull(),
    contentHash: key("content_hash", 128).notNull(),
    projectId: id("project_id").notNull(),
    createdAt: timestamp("created_at").notNull(),
    sizeBytes: bigint("size_bytes"),
    releasedAt: timestamp("released_at"),
    collectingAt: timestamp("collecting_at"),
    claimToken: id("claim_token"),
  },
  {
    primaryKey: { columns: ["buildId", "contentHash"] },
    indexes: [index("content_uses_hash_idx", ["contentHash"])],
  },
);
