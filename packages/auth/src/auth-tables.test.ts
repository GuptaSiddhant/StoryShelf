/**
 * The hand-written auth tables against core's neutral tables (ADR 0041 task 3a): each infers the
 * row of its neutral table, in both dialects. `@storyshelf/db`'s table-factory tests check that the
 * neutral tables generate the auth DDL of `ddl.ts`.
 */
import * as ns from "@storyshelf/core/db";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  authAccountPg,
  authPasskeyPg,
  authSessionPg,
  authSsoProviderPg,
  authUserPg,
  authVerificationPg,
  baseAuthTablesPg,
} from "./auth-tables-pg.ts";
import {
  authAccount,
  authPasskey,
  authSession,
  authSsoProvider,
  authUser,
  authVerification,
  baseAuthTables,
} from "./auth-tables.ts";

describe("auth tables", () => {
  it("infer the rows of the neutral auth tables (SQLite)", () => {
    expectTypeOf(authUser.$inferSelect).toEqualTypeOf<ns.InferRow<typeof ns.authUser>>();
    expectTypeOf(authSession.$inferSelect).toEqualTypeOf<ns.InferRow<typeof ns.authSession>>();
    expectTypeOf(authAccount.$inferSelect).toEqualTypeOf<ns.InferRow<typeof ns.authAccount>>();
    expectTypeOf(authVerification.$inferSelect).toEqualTypeOf<
      ns.InferRow<typeof ns.authVerification>
    >();
    expectTypeOf(authPasskey.$inferSelect).toEqualTypeOf<ns.InferRow<typeof ns.authPasskey>>();
    expectTypeOf(authSsoProvider.$inferSelect).toEqualTypeOf<
      ns.InferRow<typeof ns.authSsoProvider>
    >();
  });

  it("infer the rows of the neutral auth tables (Postgres)", () => {
    expectTypeOf(authUserPg.$inferSelect).toEqualTypeOf<ns.InferRow<typeof ns.authUser>>();
    expectTypeOf(authSessionPg.$inferSelect).toEqualTypeOf<ns.InferRow<typeof ns.authSession>>();
    expectTypeOf(authAccountPg.$inferSelect).toEqualTypeOf<ns.InferRow<typeof ns.authAccount>>();
    expectTypeOf(authVerificationPg.$inferSelect).toEqualTypeOf<
      ns.InferRow<typeof ns.authVerification>
    >();
    expectTypeOf(authPasskeyPg.$inferSelect).toEqualTypeOf<ns.InferRow<typeof ns.authPasskey>>();
    expectTypeOf(authSsoProviderPg.$inferSelect).toEqualTypeOf<
      ns.InferRow<typeof ns.authSsoProvider>
    >();
  });

  it("name the same SQL tables as the neutral ones", () => {
    const neutral = [
      ns.authUser,
      ns.authSession,
      ns.authAccount,
      ns.authVerification,
      ns.authPasskey,
      ns.authSsoProvider,
    ].map((table) => table.name);
    expect(Object.keys(baseAuthTables)).toEqual(neutral);
    expect(Object.keys(baseAuthTablesPg)).toEqual(neutral);
  });
});
