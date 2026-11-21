/**
 * Spike #800 (ADR 0041 decisions 2 and 3): the neutral tables built by `mysqlTableOf` generate,
 * through drizzle-kit, the same DDL as `ddl.ts` apart from the differences listed and classified
 * below, and infer exactly the hand-written Drizzle row types.
 */
import type { BuildLabel, LabelType, User } from "@storyshelf/core/schema";
import { compareDdlShapes, ddlShape, neutralSchema as ns } from "@storyshelf/core/test-helpers";
import { indexStatementsIn } from "@storyshelf/core/test-helpers";
import { generateMySQLDrizzleJson, generateMySQLMigration } from "drizzle-kit/api";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import { DDL } from "./ddl.ts";
import * as schema from "./schema/index.ts";
import { mysqlTableOf } from "./table-factory.ts";

const MIGRATE_SOURCE = readFileSync(fileURLToPath(new URL("migrate.ts", import.meta.url)), "utf8");
const external = { projects: schema.projects };
const resolve = ns.resolverOf(external);
const resolverOf = (tables: Record<string, unknown>) =>
  ns.resolverOf({ ...external, ...tables } as never);
const TABLES = ns.SPIKE_TABLES.map((table) => table.name);

/** Every remaining difference, `today → generated`, with its classification. */
/** None: MySQL's generated DDL matches `ddl.ts` plus `migrate.ts`'s indexes exactly. */
const DIFFERENCES: readonly { difference: string; kind: "equivalent" | "factory" | "schema" }[] =
  [];

async function generatedDdl(): Promise<string> {
  const built = ns.buildAll(ns.SPIKE_TABLES, mysqlTableOf, external);
  const before = await generateMySQLDrizzleJson({});
  const after = await generateMySQLDrizzleJson(built);
  return (await generateMySQLMigration(before, after)).join(";\n");
}

describe("MySQL table factory (spike #800)", () => {
  it("generates the DDL of ddl.ts apart from the classified differences", async () => {
    const today = ddlShape([DDL, ...indexStatementsIn(MIGRATE_SOURCE)].join(";\n"), "mysql");
    const generated = ddlShape(await generatedDdl(), "mysql");
    expect(compareDdlShapes(TABLES, today, generated)).toEqual(
      DIFFERENCES.map((entry) => entry.difference),
    );
  });

  it("infers the hand-written Drizzle row types", () => {
    const builds = mysqlTableOf(ns.builds, resolve);
    const users = mysqlTableOf(ns.users, resolve);
    const labelTypes = mysqlTableOf(ns.labelTypes, resolve);
    const buildLabels = mysqlTableOf(ns.buildLabels, resolve);
    expectTypeOf(builds.$inferSelect).toEqualTypeOf<typeof schema.builds.$inferSelect>();
    expectTypeOf(builds.$inferInsert).toEqualTypeOf<typeof schema.builds.$inferInsert>();
    expectTypeOf(users.$inferSelect).toEqualTypeOf<typeof schema.users.$inferSelect>();
    expectTypeOf(users.$inferInsert).toEqualTypeOf<typeof schema.users.$inferInsert>();
    expectTypeOf(labelTypes.$inferSelect).toEqualTypeOf<LabelType>();
    expectTypeOf(buildLabels.$inferSelect).toEqualTypeOf<BuildLabel>();
    expectTypeOf(buildLabels.$inferInsert).toEqualTypeOf<typeof schema.buildLabels.$inferInsert>();
    expectTypeOf(users.$inferSelect).toEqualTypeOf<ns.InferRow<typeof ns.users>>();
    expectTypeOf(builds.$inferSelect).toEqualTypeOf<ns.InferRow<typeof ns.builds>>();
    const references = mysqlTableOf(ns.buildReferences, resolverOf({ builds }));
    const generations = mysqlTableOf(ns.buildReferenceGenerations, resolve);
    const deletions = mysqlTableOf(ns.buildDeletions, resolverOf({ builds }));
    const releases = mysqlTableOf(ns.buildContentReleases, resolverOf({ builds }));
    expectTypeOf(references.$inferSelect).toEqualTypeOf<ns.InferRow<typeof ns.buildReferences>>();
    expectTypeOf(generations.$inferSelect).toEqualTypeOf<
      ns.InferRow<typeof ns.buildReferenceGenerations>
    >();
    expectTypeOf(deletions.$inferSelect).toEqualTypeOf<ns.InferRow<typeof ns.buildDeletions>>();
    expectTypeOf(releases.$inferSelect).toEqualTypeOf<
      ns.InferRow<typeof ns.buildContentReleases>
    >();
    expectTypeOf(users.$inferSelect).toExtend<User>();
    expect(Object.keys(builds)).toContain("retentionState");
  });

  it("refuses a json<T> column until a table needs one", () => {
    const doc = ns.defineTable("docs", { body: ns.json<{ a: number }>("body") });
    expect(() => mysqlTableOf(doc, resolve)).toThrow("json<T> column body");
  });

  it("cannot express a partial index", () => {
    const partial = ns.defineTable(
      "partials",
      { id: ns.id("id").primaryKey(), key: ns.key("key", 64) },
      { indexes: [ns.uniqueIndex("partials_key_idx", ["key"], "key IS NOT NULL")] },
    );
    expect(() => mysqlTableOf(partial, resolve)).toThrow("MySQL has no partial indexes");
  });

  it("needs a length for every bounded column", () => {
    const bad = ns.defineTable("bad", {
      ownerId: new ns.NeutralColumn<string>({ ...ns.id("o").spec, length: undefined }),
    });
    expect(() => mysqlTableOf(bad, resolve)).toThrow("MySQL needs a length for id column o");
  });
});
