import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { builds } from "./build.ts";
import { users } from "./user.ts";

/** Narrow `build_reviews` table definition: one verdict of one reviewer on one build. */
export const buildReviews = sqliteTable(
  "build_reviews",
  {
    id: text("id").primaryKey(),
    buildId: text("build_id")
      .notNull()
      .references(() => builds.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    verdict: text("verdict").$type<"approved" | "rejected">().notNull(),
    body: text("body"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("build_reviews_build_id_idx").on(table.buildId)],
);
