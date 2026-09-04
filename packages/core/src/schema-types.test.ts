import { expectTypeOf, it } from "vitest";
import {
  baselines,
  buildLabels,
  builds,
  comments,
  labelTypes,
  projectMembers,
  projects,
  projectStatusConfigs,
  snapshots,
  tokens,
  users,
  webhooks,
} from "./schema-tables.ts";
import type {
  Baseline,
  Build,
  BuildLabel,
  Comment,
  LabelType,
  Project,
  ProjectMember,
  ProjectStatusConfig,
  Snapshot,
  Token,
  User,
  Webhook,
} from "./schema.ts";

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
