/**
 * Spike #800 (ADR 0041 decisions 2 and 3): the neutral tables built by `sqliteTableOf` generate,
 * through drizzle-kit, the same DDL as `ddl.ts` apart from the differences listed and classified
 * below, and infer exactly the hand-written Drizzle row types.
 */
import type { BuildLabel, LabelType, User } from "@storyshelf/core/schema";
import { compareDdlShapes, ddlShape, neutralSchema as ns } from "@storyshelf/core/test-helpers";
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import { describe, expect, expectTypeOf, it } from "vitest";
import { DDL, IDENTITY_STATEMENTS } from "./ddl.ts";
import * as schema from "./schema/index.ts";
import { sqliteTableOf } from "./table-factory.ts";

const external = { projects: schema.projects };
const resolve = ns.resolverOf(external);
const resolverOf = (tables: Record<string, unknown>) =>
  ns.resolverOf({ ...external, ...tables } as never);
const TABLES = ns.SPIKE_TABLES.map((table) => table.name);

/** Every remaining difference, `today → generated`, with its classification. */
const DIFFERENCES: readonly { difference: string; kind: "equivalent" | "factory" | "schema" }[] = [
  {
    // drizzle-kit writes a column's UNIQUE as a named unique index; ddl.ts's inline UNIQUE gets
    // SQLite's own autoindex. Same constraint; nothing refers to either name.
    difference: "users unique (email): name sqlite_autoindex_users_1 → users_email_unique",
    kind: "equivalent",
  },
];

async function generatedDdl(): Promise<string> {
  const built = ns.buildAll(ns.SPIKE_TABLES, sqliteTableOf, external);
  const before = await generateSQLiteDrizzleJson({});
  const after = await generateSQLiteDrizzleJson(built);
  return (await generateSQLiteMigration(before, after)).join(";\n");
}

describe("SQLite table factory (spike #800)", () => {
  it("generates the DDL of ddl.ts apart from the classified differences", async () => {
    const today = ddlShape([DDL, ...IDENTITY_STATEMENTS].join(";\n"), "sqlite");
    const generated = ddlShape(await generatedDdl(), "sqlite");
    expect(compareDdlShapes(TABLES, today, generated)).toEqual(
      DIFFERENCES.map((entry) => entry.difference),
    );
  });

  it("infers the hand-written Drizzle row types", () => {
    const builds = sqliteTableOf(ns.builds, resolve);
    const users = sqliteTableOf(ns.users, resolve);
    const labelTypes = sqliteTableOf(ns.labelTypes, resolve);
    const buildLabels = sqliteTableOf(ns.buildLabels, resolve);
    expectTypeOf(builds.$inferSelect).toEqualTypeOf<typeof schema.builds.$inferSelect>();
    expectTypeOf(builds.$inferInsert).toEqualTypeOf<typeof schema.builds.$inferInsert>();
    expectTypeOf(users.$inferSelect).toEqualTypeOf<typeof schema.users.$inferSelect>();
    expectTypeOf(users.$inferInsert).toEqualTypeOf<typeof schema.users.$inferInsert>();
    expectTypeOf(labelTypes.$inferSelect).toEqualTypeOf<LabelType>();
    expectTypeOf(buildLabels.$inferSelect).toEqualTypeOf<BuildLabel>();
    expectTypeOf(buildLabels.$inferInsert).toEqualTypeOf<typeof schema.buildLabels.$inferInsert>();
    expectTypeOf(users.$inferSelect).toEqualTypeOf<ns.InferRow<typeof ns.users>>();
    expectTypeOf(builds.$inferSelect).toEqualTypeOf<ns.InferRow<typeof ns.builds>>();
    const references = sqliteTableOf(ns.buildReferences, resolverOf({ builds }));
    const generations = sqliteTableOf(ns.buildReferenceGenerations, resolve);
    const deletions = sqliteTableOf(ns.buildDeletions, resolverOf({ builds }));
    const releases = sqliteTableOf(ns.buildContentReleases, resolverOf({ builds }));
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
    expect(() => sqliteTableOf(doc, resolve)).toThrow("json<T> column body");
  });

  it("expresses a partial index", async () => {
    const partial = ns.defineTable(
      "partials",
      { id: ns.id("id").primaryKey(), key: ns.key("key", 64) },
      { indexes: [ns.uniqueIndex("partials_key_idx", ["key"], "key IS NOT NULL")] },
    );
    const after = await generateSQLiteDrizzleJson({ partials: sqliteTableOf(partial, resolve) });
    const statements = await generateSQLiteMigration(await generateSQLiteDrizzleJson({}), after);
    expect(statements.join("\n")).toMatch(
      /UNIQUE INDEX .partials_key_idx. .* WHERE key IS NOT NULL/u,
    );
  });
});
