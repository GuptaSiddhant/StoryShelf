import type { ProjectRole } from "@storyshelf/core/types";
import { mysqlTable, text, datetime, uniqueIndex } from "drizzle-orm/mysql-core";
import { projects } from "./project.ts";
import { users } from "./user.ts";

/** Narrow `project_members` table definition. */
export const projectMembers = mysqlTable(
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
    source: text("source").notNull().default("manual"),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
  },
  (t) => [uniqueIndex("project_members_project_user_idx").on(t.projectId, t.userId)],
);

/** A project-membership row. */
export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  /** Provenance: `manual` grants vs `oidc:<group>` synced grants. */
  source: string;
  createdAt: string;
}
