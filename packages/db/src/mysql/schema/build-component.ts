import { index, int, mysqlTable, text } from "drizzle-orm/mysql-core";
import { builds } from "./build.ts";
import { datetime } from "./datetime.ts";
import { projects } from "./project.ts";

/** Narrow `build_components` table definition: one row per component of a published build. */
export const buildComponents = mysqlTable(
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
    storyCount: int("story_count").notNull().default(0),
    hash: text("hash").notNull(),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
  },
  (table) => [
    index("build_components_build_id_idx").on(table.buildId),
    index("build_components_project_import_path_idx").on(table.projectId, table.importPath),
  ],
);
