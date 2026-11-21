import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { builds } from "./build.ts";
import { projects } from "./project.ts";

/** Narrow `label_types` table definition. */
export const labelTypes = sqliteTable(
  "label_types",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    linkTemplate: text("link_template"),
    color: text("color"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("label_types_project_key_idx").on(t.projectId, t.key)],
);

/** Narrow `build_labels` table definition. */
export const buildLabels = sqliteTable(
  "build_labels",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    buildId: text("build_id")
      .notNull()
      .references(() => builds.id, { onDelete: "cascade" }),
    typeKey: text("type_key").notNull(),
    value: text("value").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("build_labels_build_type_value_idx").on(t.buildId, t.typeKey, t.value)],
);

/** A label-type row. */
export interface LabelType {
  id: string;
  projectId: string;
  key: string;
  name: string;
  linkTemplate: string | null;
  color: string | null;
  createdAt: string;
}

/** A build-label row. */
export interface BuildLabel {
  id: string;
  projectId: string;
  buildId: string;
  typeKey: string;
  value: string;
  createdAt: string;
}
