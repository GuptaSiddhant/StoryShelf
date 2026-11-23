/** `label_types` and `build_labels` as neutral tables (spike #800; not wired into any adapter). */
import { id, key, text, timestamp } from "../columns.ts";
import { defineTable, uniqueIndex } from "../define-table.ts";

export const labelTypes = defineTable(
  "label_types",
  {
    id: id("id").primaryKey(),
    projectId: id("project_id").notNull().references("projects", "id", "cascade"),
    key: key("key", 255).notNull(),
    name: text("name").notNull(),
    linkTemplate: text("link_template"),
    color: text("color"),
    createdAt: timestamp("created_at").notNull(),
  },
  { indexes: [uniqueIndex("label_types_project_key_idx", ["projectId", "key"])] },
);

export const buildLabels = defineTable(
  "build_labels",
  {
    id: id("id").primaryKey(),
    projectId: id("project_id").notNull().references("projects", "id", "cascade"),
    buildId: id("build_id").notNull().references("builds", "id", "cascade"),
    typeKey: key("type_key", 64).notNull(),
    value: key("value", 255).notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  {
    indexes: [uniqueIndex("build_labels_build_type_value_idx", ["buildId", "typeKey", "value"])],
  },
);
