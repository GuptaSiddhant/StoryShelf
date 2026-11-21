/**
 * Spike #800 (ADR 0041 decisions 2 and 3): the neutral tables built by `pgTableOf` generate,
 * through drizzle-kit, the same DDL as `ddl.ts` apart from the differences listed and classified
 * below, and infer exactly the hand-written Drizzle row types.
 */
import type { BuildLabel, LabelType, User } from "@storyshelf/core/schema";
import { compareDdlShapes, ddlShape, neutralSchema as ns } from "@storyshelf/core/test-helpers";
import { indexStatementsIn } from "@storyshelf/core/test-helpers";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/payload/postgres";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import { DDL } from "./ddl.ts";
import * as schema from "./schema/index.ts";
import { pgTableOf } from "./table-factory.ts";

const MIGRATE_SOURCE = readFileSync(fileURLToPath(new URL("migrate.ts", import.meta.url)), "utf8");
const external = { projects: schema.projects };
const resolve = ns.resolverOf(external);
const resolverOf = (tables: Record<string, unknown>) =>
  ns.resolverOf({ ...external, ...tables } as never);
const TABLES = ns.SPIKE_TABLES.map((table) => table.name);

/** Every remaining difference, `today → generated`, with its classification. */
const DIFFERENCES: readonly { difference: string; kind: "equivalent" | "factory" | "schema" }[] = [
  {
    // ddl.ts disagrees across dialects (MySQL BIGINT, Postgres INTEGER). The neutral `bigint`
    // makes them agree; on Postgres that is a widening, an ADR 0053 expand step.
    difference: 'build_reference_generations.generation: type "integer" → "bigint"',
    kind: "schema",
  },
];

async function generatedDdl(): Promise<string> {
  const built = ns.buildAll(ns.SPIKE_TABLES, pgTableOf, external);
  const before = await generateDrizzleJson({});
  const after = await generateDrizzleJson(built);
  return (await generateMigration(before, after)).join(";\n");
}

describe("Postgres table factory (spike #800)", () => {
  it("generates the DDL of ddl.ts apart from the classified differences", async () => {
    const today = ddlShape([DDL, ...indexStatementsIn(MIGRATE_SOURCE)].join(";\n"), "pg");
    const generated = ddlShape(await generatedDdl(), "pg");
    expect(compareDdlShapes(TABLES, today, generated)).toEqual(
      DIFFERENCES.map((entry) => entry.difference),
    );
  });

  it("infers the hand-written Drizzle row types", () => {
    const builds = pgTableOf(ns.builds, resolve);
    const users = pgTableOf(ns.users, resolve);
    const labelTypes = pgTableOf(ns.labelTypes, resolve);
    const buildLabels = pgTableOf(ns.buildLabels, resolve);
    expectTypeOf(builds.$inferSelect).toEqualTypeOf<typeof schema.builds.$inferSelect>();
    expectTypeOf(builds.$inferInsert).toEqualTypeOf<typeof schema.builds.$inferInsert>();
    expectTypeOf(users.$inferSelect).toEqualTypeOf<typeof schema.users.$inferSelect>();
    expectTypeOf(users.$inferInsert).toEqualTypeOf<typeof schema.users.$inferInsert>();
    expectTypeOf(labelTypes.$inferSelect).toEqualTypeOf<LabelType>();
    expectTypeOf(buildLabels.$inferSelect).toEqualTypeOf<BuildLabel>();
    expectTypeOf(buildLabels.$inferInsert).toEqualTypeOf<typeof schema.buildLabels.$inferInsert>();
    expectTypeOf(users.$inferSelect).toEqualTypeOf<ns.InferRow<typeof ns.users>>();
    expectTypeOf(builds.$inferSelect).toEqualTypeOf<ns.InferRow<typeof ns.builds>>();
    const references = pgTableOf(ns.buildReferences, resolverOf({ builds }));
    const generations = pgTableOf(ns.buildReferenceGenerations, resolve);
    const deletions = pgTableOf(ns.buildDeletions, resolverOf({ builds }));
    const releases = pgTableOf(ns.buildContentReleases, resolverOf({ builds }));
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
    expect(() => pgTableOf(doc, resolve)).toThrow("json<T> column body");
  });

  it("expresses a partial index", async () => {
    const partial = ns.defineTable(
      "partials",
      { id: ns.id("id").primaryKey(), key: ns.key("key", 64) },
      { indexes: [ns.uniqueIndex("partials_key_idx", ["key"], "key IS NOT NULL")] },
    );
    const after = await generateDrizzleJson({ partials: pgTableOf(partial, resolve) });
    const statements = await generateMigration(await generateDrizzleJson({}), after);
    expect(statements.join("\n")).toMatch(
      /UNIQUE INDEX .partials_key_idx. .* WHERE key IS NOT NULL/u,
    );
  });

  it("qualifies foreign-key targets with the public schema", async () => {
    // Equivalent today: the adapter never sets a search_path, so every table is in `public`.
    expect(await generatedDdl()).toContain('REFERENCES "public"."projects"("id")');
  });
});
