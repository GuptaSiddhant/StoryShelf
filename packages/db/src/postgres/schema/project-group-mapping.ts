import type { ProjectRole } from "@storyshelf/core/types";
import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { projects } from "./project.ts";

/** Narrow `project_group_mappings` table definition. */
export const projectGroupMappings = pgTable(
  "project_group_mappings",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    groupName: text("group_name").notNull(),
    role: text("role").$type<ProjectRole>().notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [uniqueIndex("project_group_mappings_project_group_idx").on(t.projectId, t.groupName)],
);

/** An identity-provider group to project-role mapping row. */
export interface ProjectGroupMapping {
  id: string;
  projectId: string;
  groupName: string;
  role: ProjectRole;
  createdAt: string;
}
