/**
 * The neutral tables against the core row types (ADR 0041 decision 2): `LabelType` and
 * `BuildLabel` match exactly; `User` and `Build` differ only as listed, which task 3 resolves by
 * deriving the core types from these tables.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Build } from "../../schema/build.ts";
import type { CaptureAttempt, CaptureLog } from "../../schema/capture-attempt.ts";
import type { CaptureJobRow } from "../../schema/capture-job.ts";
import type { CaptureShard } from "../../schema/capture-shard.ts";
import type { UserConnection } from "../../schema/connection.ts";
import type { BuildLabel, LabelType } from "../../schema/label.ts";
import type { ProjectMember } from "../../schema/member.ts";
import type { ProjectGroupMapping } from "../../schema/project-group-mapping.ts";
import type { Project } from "../../schema/project.ts";
import type { SchemaMeta } from "../../schema/schema-meta.ts";
import type { SiteSetting } from "../../schema/site-setting.ts";
import type { Token } from "../../schema/token.ts";
import type { ProjectLink } from "../../schema/usage.ts";
import type { User } from "../../schema/user.ts";
import type { Webhook } from "../../schema/webhook.ts";
import type { InferRow } from "../define-table.ts";
import {
  builds,
  buildLabels,
  captureAttempts,
  captureJobs,
  captureLogs,
  captureShards,
  labelTypes,
  NEUTRAL_TABLES,
  projectGroupMappings,
  projectLinks,
  projectMembers,
  projects,
  schemaMeta,
  siteSettings,
  tokens,
  userConnections,
  users,
  webhooks,
} from "./index.ts";

describe("spike tables", () => {
  it("match the core label rows exactly", () => {
    expectTypeOf<InferRow<typeof labelTypes>>().toEqualTypeOf<LabelType>();
    expectTypeOf<InferRow<typeof buildLabels>>().toEqualTypeOf<BuildLabel>();
  });

  it("match the core project-membership rows exactly", () => {
    expectTypeOf<InferRow<typeof projectMembers>>().toEqualTypeOf<ProjectMember>();
    expectTypeOf<InferRow<typeof projectGroupMappings>>().toEqualTypeOf<ProjectGroupMapping>();
    expectTypeOf<InferRow<typeof projectLinks>>().toEqualTypeOf<ProjectLink>();
  });

  it("match the core settings, token, connection and webhook rows exactly", () => {
    expectTypeOf<InferRow<typeof siteSettings>>().toEqualTypeOf<SiteSetting>();
    expectTypeOf<InferRow<typeof schemaMeta>>().toEqualTypeOf<SchemaMeta>();
    expectTypeOf<InferRow<typeof tokens>>().toEqualTypeOf<Token>();
    expectTypeOf<InferRow<typeof userConnections>>().toEqualTypeOf<UserConnection>();
    expectTypeOf<InferRow<typeof webhooks>>().toEqualTypeOf<Webhook>();
  });

  it("match the core capture rows, the log level apart", () => {
    expectTypeOf<InferRow<typeof captureJobs>>().toEqualTypeOf<CaptureJobRow>();
    expectTypeOf<InferRow<typeof captureAttempts>>().toEqualTypeOf<CaptureAttempt>();
    expectTypeOf<InferRow<typeof captureShards>>().toEqualTypeOf<CaptureShard>();
    // `CaptureLog` narrows `level` to `CaptureLogLevel`; the Drizzle schemas read it as `string`.
    type Log = InferRow<typeof captureLogs>;
    expectTypeOf<Omit<Log, "level">>().toEqualTypeOf<Omit<CaptureLog, "level">>();
    expectTypeOf<Log["level"]>().toEqualTypeOf<string>();
  });

  it("match the core project row apart from storybook_meta", () => {
    // `Project` marks fourteen columns optional that every dialect always returns, and reads
    // `storybookMeta` as `string | null | undefined` (the Drizzle schemas' `$type`); the column is
    // plain nullable text.
    type Row = InferRow<typeof projects>;
    expectTypeOf<Omit<Row, "storybookMeta">>().toEqualTypeOf<
      Required<Omit<Project, "storybookMeta">>
    >();
    expectTypeOf<Row["storybookMeta"]>().toEqualTypeOf<string | null>();
  });

  it("match the core user row once its optional fields are required", () => {
    // `User` marks four columns optional (`passwordHash?` …) that every dialect always returns.
    expectTypeOf<InferRow<typeof users>>().toEqualTypeOf<Required<User>>();
  });

  it("match the core build row apart from retention_state and branch_verified", () => {
    // `Build` has no `retentionState`, marks ten columns optional, and narrows `branchVerified`
    // to `BranchVerification`, which the Drizzle schemas read as `string`.
    type Row = InferRow<typeof builds>;
    expectTypeOf<Omit<Row, "retentionState" | "branchVerified">>().toEqualTypeOf<
      Required<Omit<Build, "branchVerified">>
    >();
    expectTypeOf<Row["branchVerified"]>().toEqualTypeOf<string | null>();
  });

  it("list every table parents first", () => {
    const names = NEUTRAL_TABLES.map((table) => table.name);
    expect(names.indexOf("builds")).toBeLessThan(names.indexOf("build_labels"));
    expect(names.indexOf("users")).toBeLessThan(names.indexOf("builds"));
    expect(names.indexOf("projects")).toBe(0);
    expect(names.indexOf("users")).toBeLessThan(names.indexOf("project_members"));
    expect(names.indexOf("users")).toBeLessThan(names.indexOf("user_invite_tokens"));
    expect(names.indexOf("capture_attempts")).toBeLessThan(names.indexOf("capture_logs"));
    expect(new Set(names).size).toBe(24);
  });
});
