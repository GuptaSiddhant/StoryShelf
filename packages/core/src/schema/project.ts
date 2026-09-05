import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Narrow `projects` table definition. */
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  gitRepository: text("git_repository"),
  gitDefaultBranch: text("git_default_branch").notNull().default("main"),
  pixelThreshold: real("pixel_threshold").notNull().default(0.1),
  maxDiffRatio: real("max_diff_ratio").notNull().default(0.01),
  publicBranchRegex: text("public_branch_regex"),
  storybookMeta: text("storybook_meta").$type<string | null | undefined>().default(null),
  executePlay: integer("execute_play", { mode: "boolean" }).notNull().default(false),
  playTimeoutMs: integer("play_timeout_ms").notNull().default(10_000),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** A project row. */
export interface Project {
  id: string;
  name: string;
  slug: string;
  gitRepository: string | null;
  gitDefaultBranch: string;
  pixelThreshold: number;
  maxDiffRatio: number;
  publicBranchRegex: string | null;
  storybookMeta: string | null | undefined;
  executePlay: boolean;
  playTimeoutMs: number;
  createdAt: string;
  updatedAt: string;
}

/** Storybook metadata synced from a project's published Storybook. */
export interface StorybookMeta {
  framework?: { name?: string; options?: unknown };
  addons?: string[];
  storiesGlobs?: string[];
  staticDirs?: string[];
  packagePath?: string;
  previewParameters?: Record<string, unknown>;
}
