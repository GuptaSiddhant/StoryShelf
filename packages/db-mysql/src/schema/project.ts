import { boolean, double, int, mysqlTable, text, datetime } from "drizzle-orm/mysql-core";

/** Narrow `projects` table definition. */
export const projects = mysqlTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  gitRepository: text("git_repository"),
  gitDefaultBranch: text("git_default_branch").notNull().default("main"),
  pixelThreshold: double("pixel_threshold").notNull().default(0.1),
  maxDiffRatio: double("max_diff_ratio").notNull().default(0.01),
  publicBranchRegex: text("public_branch_regex"),
  storybookMeta: text("storybook_meta").$type<string | null | undefined>().default(null),
  executePlay: boolean("execute_play").notNull().default(false),
  playTimeoutMs: int("play_timeout_ms").notNull().default(10_000),
  runA11y: boolean("run_a11y").notNull().default(false),
  browser: text("browser").notNull().default("chromium"),
  viewports: text("viewports"),
  automigrate: boolean("automigrate").notNull().default(false),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
  updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull(),
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
  runA11y?: boolean;
  browser?: string;
  viewports?: string | null;
  automigrate: boolean;
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
