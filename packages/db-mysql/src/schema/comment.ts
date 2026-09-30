import { boolean, index, mysqlTable, text, datetime } from "drizzle-orm/mysql-core";
import { builds } from "./build.ts";
import { projects } from "./project.ts";
import { snapshots } from "./snapshot.ts";
import { users } from "./user.ts";

/** Narrow `comments` table definition. */
export const comments = mysqlTable(
  "comments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    buildId: text("build_id")
      .notNull()
      .references(() => builds.id, { onDelete: "cascade" }),
    snapshotId: text("snapshot_id").references(() => snapshots.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    parentId: text("parent_id"),
    resolved: boolean("resolved").notNull().default(false),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull(),
  },
  (t) => [index("comments_build_id_idx").on(t.buildId)],
);

/** A comment row. */
export interface Comment {
  id: string;
  projectId: string;
  buildId: string;
  snapshotId: string | null;
  userId: string | null;
  body: string;
  parentId: string | null;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}
