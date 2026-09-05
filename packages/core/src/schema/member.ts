import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { ProjectRole } from "../types.ts";
import { projects } from "./project.ts";
import { users } from "./user.ts";

/** Narrow `project_members` table definition. */
export const projectMembers = sqliteTable(
  "project_members",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<ProjectRole>().notNull().default("viewer"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("project_members_project_user_idx").on(t.projectId, t.userId)],
);

/** A project-membership row. */
export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  createdAt: string;
}
