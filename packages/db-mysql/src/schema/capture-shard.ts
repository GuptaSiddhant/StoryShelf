import type { CaptureShardKind, CaptureShardStatus } from "@storyshelf/core/schema";
import { index, int, mysqlTable, text, uniqueIndex } from "drizzle-orm/mysql-core";
import { builds } from "./build.ts";
import { datetime } from "./datetime.ts";
import { projects } from "./project.ts";

/** Narrow `capture_shards` table definition: the stages of a sharded capture and its finalize claim. */
export const captureShards = mysqlTable(
  "capture_shards",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    buildId: text("build_id")
      .notNull()
      .references(() => builds.id, { onDelete: "cascade" }),
    kind: text("kind").$type<CaptureShardKind>().notNull(),
    ordinal: int("ordinal").notNull(),
    status: text("status").$type<CaptureShardStatus>().notNull().default("pending"),
    attemptId: text("attempt_id"),
    payload: text("payload"),
    result: text("result"),
    error: text("error"),
    startedAt: datetime("started_at", { mode: "string", fsp: 3 }),
    finishedAt: datetime("finished_at", { mode: "string", fsp: 3 }),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull(),
  },
  (t) => [
    uniqueIndex("capture_shards_build_kind_ordinal_idx").on(t.buildId, t.kind, t.ordinal),
    index("capture_shards_build_id_idx").on(t.buildId),
  ],
);
