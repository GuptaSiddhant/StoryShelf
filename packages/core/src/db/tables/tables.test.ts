/**
 * The spike tables against the core row types (ADR 0041 decision 2): `LabelType` and
 * `BuildLabel` match exactly; `User` and `Build` differ only as listed, which task 3 resolves by
 * deriving the core types from these tables.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Build } from "../../schema/build.ts";
import type { BuildLabel, LabelType } from "../../schema/label.ts";
import type { User } from "../../schema/user.ts";
import type { InferRow } from "../define-table.ts";
import { builds, buildLabels, labelTypes, SPIKE_TABLES, users } from "./index.ts";

describe("spike tables", () => {
  it("match the core label rows exactly", () => {
    expectTypeOf<InferRow<typeof labelTypes>>().toEqualTypeOf<LabelType>();
    expectTypeOf<InferRow<typeof buildLabels>>().toEqualTypeOf<BuildLabel>();
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
    const names = SPIKE_TABLES.map((table) => table.name);
    expect(names.indexOf("builds")).toBeLessThan(names.indexOf("build_labels"));
    expect(names.indexOf("users")).toBeLessThan(names.indexOf("builds"));
    expect(new Set(names).size).toBe(8);
  });
});
