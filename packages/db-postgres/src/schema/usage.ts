import { pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { builds } from "./build.ts";
import { projects } from "./project.ts";

/** Narrow `project_links` table definition. */
export const projectLinks = pgTable(
  "project_links",
  {
    id: text("id").primaryKey(),
    downstreamId: text("downstream_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    upstreamId: text("upstream_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    packageName: text("package_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [uniqueIndex("project_links_downstream_package_idx").on(t.downstreamId, t.packageName)],
);

/** Narrow `build_package_usage` table definition. */
export const buildPackageUsage = pgTable(
  "build_package_usage",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    buildId: text("build_id")
      .notNull()
      .references(() => builds.id, { onDelete: "cascade" }),
    storyImportPath: text("story_import_path").notNull(),
    packageName: text("package_name").notNull(),
    modulePath: text("module_path").notNull(),
    version: text("version"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [index("build_package_usage_build_id_idx").on(t.buildId)],
);

/** A link from a downstream project to the upstream project that publishes a package it consumes. */
export interface ProjectLink {
  id: string;
  /** Project that consumes the package (the app). */
  downstreamId: string;
  /** Project whose Storybook publishes the package's components (the design system). */
  upstreamId: string;
  packageName: string;
  createdAt: string;
}

/** A dependency package a story file reaches in a build. */
export interface BuildPackageUsage {
  id: string;
  projectId: string;
  buildId: string;
  /** Story import path, joined to `snapshots.storyImportPath` at read time. */
  storyImportPath: string;
  packageName: string;
  /** First module inside the package the story reaches. */
  modulePath: string;
  /** Installed package version at upload time; null when it could not be resolved. */
  version: string | null;
  createdAt: string;
}
