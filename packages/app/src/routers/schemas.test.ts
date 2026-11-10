import { describe, expect, it } from "vite-plus/test";
import * as schemas from "./schemas.ts";

/** The names the routers import from `schemas.ts`; the split into `schemas/*` must not change them. */
const EXPORTED = [
  "approveAllResultSchema",
  "attemptLogSchema",
  "attemptSchema",
  "badRequest",
  "baselineChangedSchema",
  "buildReviewCreateSchema",
  "buildReviewSchema",
  "buildReviewStateSchema",
  "buildSchema",
  "commentCreateSchema",
  "commentSchema",
  "errorSchema",
  "forbidden",
  "groupDecisionResultSchema",
  "groupMappingCreateSchema",
  "groupMappingSchema",
  "healthRequestSchema",
  "insightRequestSchema",
  "insightSchema",
  "labelTypeCreateSchema",
  "labelTypeSchema",
  "labelTypeUpdateSchema",
  "memberRoleSchema",
  "memberSchema",
  "memberSetSchema",
  "notFound",
  "notificationChannelCreateSchema",
  "notificationChannelSchema",
  "notificationSubscriptionPutSchema",
  "notificationSubscriptionSchema",
  "okSchema",
  "projectCreateSchema",
  "projectSchema",
  "projectUpdateSchema",
  "purgeInputSchema",
  "purgeSchema",
  "rediffResultSchema",
  "snapshotSchema",
  "tokenCreateSchema",
  "tokenCreatedSchema",
  "tokenPublicSchema",
  "unauthorized",
  "webhookCreateSchema",
  "webhookCreatedSchema",
  "webhookPublicSchema",
];

describe("schemas barrel", () => {
  it("re-exports every schema and shared response under its original name, and nothing else", () => {
    expect(Object.keys(schemas).toSorted()).toEqual(EXPORTED);
  });

  it("exports a defined value for each name", () => {
    for (const name of EXPORTED) {
      expect(schemas[name as keyof typeof schemas], name).toBeDefined();
    }
  });
});
