import { expect, expectTypeOf, it } from "vitest";
import { DDL } from "./ddl.ts";
import { baselines } from "./schema/baseline.ts";
import type { Baseline } from "./schema/baseline.ts";
import { builds } from "./schema/build.ts";
import type { Build } from "./schema/build.ts";
import { comments } from "./schema/comment.ts";
import type { Comment } from "./schema/comment.ts";
import { buildLabels, labelTypes } from "./schema/label.ts";
import type { BuildLabel, LabelType } from "./schema/label.ts";
import { projectMembers } from "./schema/member.ts";
import type { ProjectMember } from "./schema/member.ts";
import { projects } from "./schema/project.ts";
import type { Project } from "./schema/project.ts";
import { snapshots } from "./schema/snapshot.ts";
import type { Snapshot } from "./schema/snapshot.ts";
import { projectStatusConfigs } from "./schema/status-config.ts";
import type { ProjectStatusConfig } from "./schema/status-config.ts";
import { tokens } from "./schema/token.ts";
import type { Token } from "./schema/token.ts";
import { users } from "./schema/user.ts";
import type { User } from "./schema/user.ts";
import { webhooks } from "./schema/webhook.ts";
import type { Webhook } from "./schema/webhook.ts";

/**
 * Pin the hand-written row interfaces in `schema.ts` to Drizzle's inferred
 * row types. If a column changes, these assertions fail at typecheck time —
 * update the interface alongside the migration.
 */
it("row interfaces match drizzle inference exactly", () => {
  expectTypeOf<Project>().toEqualTypeOf<typeof projects.$inferSelect>();
  expectTypeOf<ProjectStatusConfig>().toEqualTypeOf<typeof projectStatusConfigs.$inferSelect>();
  expectTypeOf<Build>().toEqualTypeOf<typeof builds.$inferSelect>();
  expectTypeOf<Snapshot>().toEqualTypeOf<typeof snapshots.$inferSelect>();
  expectTypeOf<Baseline>().toEqualTypeOf<typeof baselines.$inferSelect>();
  expectTypeOf<Comment>().toEqualTypeOf<typeof comments.$inferSelect>();
  expectTypeOf<LabelType>().toEqualTypeOf<typeof labelTypes.$inferSelect>();
  expectTypeOf<BuildLabel>().toEqualTypeOf<typeof buildLabels.$inferSelect>();
  expectTypeOf<Token>().toEqualTypeOf<typeof tokens.$inferSelect>();
  expectTypeOf<Webhook>().toEqualTypeOf<typeof webhooks.$inferSelect>();
  expectTypeOf<User>().toEqualTypeOf<typeof users.$inferSelect>();
  expectTypeOf<ProjectMember>().toEqualTypeOf<typeof projectMembers.$inferSelect>();
});

const DDL_TABLES = [
  "projects",
  "project_status_configs",
  "builds",
  "snapshots",
  "baselines",
  "comments",
  "label_types",
  "build_labels",
  "tokens",
  "webhooks",
  "users",
  "project_members",
];

const DDL_INDEXES = [
  "builds_project_gitsha_idx",
  "builds_git_branch_idx",
  "snapshots_build_story_viewport_idx",
  "snapshots_build_id_idx",
  "baselines_project_story_viewport_branch_idx",
  "baselines_project_story_idx",
  "comments_build_id_idx",
  "label_types_project_key_idx",
  "build_labels_build_type_value_idx",
  "project_members_project_user_idx",
];

/**
 * Pin the hand-written `DDL` string to the Drizzle definitions. `ddl.ts` is
 * intentionally hand-written (drizzle-orm cannot emit SQLite DDL); if a
 * table or index changes in `schema/`, update `DDL` alongside it.
 */
it("DDL covers every table and index", () => {
  for (const table of DDL_TABLES) {
    expect(DDL).toContain(`CREATE TABLE IF NOT EXISTS ${table} (`);
  }
  for (const index of DDL_INDEXES) {
    expect(DDL).toContain(index);
  }
});
