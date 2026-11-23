import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { builds } from "./build.ts";
import { projects } from "./project.ts";

/** Narrow `build_components` table definition: one row per component of a published build. */
export const buildComponents = sqliteTable(
  "build_components",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    buildId: text("build_id")
      .notNull()
      .references(() => builds.id, { onDelete: "cascade" }),
    importPath: text("import_path").notNull(),
    title: text("title").notNull(),
    storyCount: integer("story_count").notNull().default(0),
    hash: text("hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("build_components_build_id_idx").on(table.buildId),
    index("build_components_project_import_path_idx").on(table.projectId, table.importPath),
  ],
);
