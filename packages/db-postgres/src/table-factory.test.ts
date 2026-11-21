import * as ns from "@storyshelf/core/db";
/**
 * Spike #800 (ADR 0041 decisions 2 and 3): the neutral tables built by `pgTableOf` generate,
 * through drizzle-kit, the same DDL as `ddl.ts` apart from the differences listed and classified
 * below, and infer exactly the hand-written Drizzle row types.
 */
import type { BuildLabel, LabelType, User } from "@storyshelf/core/schema";
import { compareDdlShapes, ddlShape } from "@storyshelf/core/test-helpers";
import { indexStatementsIn } from "@storyshelf/core/test-helpers";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/payload/postgres";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import { DDL } from "./ddl.ts";
import * as schema from "./schema/index.ts";
import { pgTableOf } from "./table-factory.ts";

const MIGRATE_SOURCE = readFileSync(fileURLToPath(new URL("migrate.ts", import.meta.url)), "utf8");
/** No neutral table references a hand-written one now that `projects` is neutral. */
const external = {};
const BUILT = ns.buildAll(ns.NEUTRAL_TABLES, pgTableOf, external);
const resolve = ns.resolverOf(BUILT);
const resolverOf = (tables: Record<string, unknown>) =>
  ns.resolverOf({ ...BUILT, ...tables } as never);
const TABLES = ns.NEUTRAL_TABLES.map((table) => table.name);

/**
 * Columns of a composite primary key. ddl.ts writes NOT NULL on each; drizzle-kit 1.0 leaves it to
 * the PRIMARY KEY constraint, which makes them NOT NULL in Postgres all the same.
 */
const PRIMARY_KEY_COLUMNS = [
  "build_references.project_id",
  "build_references.owner_type",
  "build_references.owner_id",
  "build_references.build_id",
  "build_reference_generations.project_id",
  "build_reference_generations.owner_type",
  "build_reference_generations.owner_id",
  "build_content_releases.build_id",
  "build_content_releases.content_hash",
];

/** Every remaining difference, `today → generated`, with its classification. */
const DIFFERENCES: readonly { difference: string; kind: "equivalent" | "factory" | "schema" }[] = [
  ...PRIMARY_KEY_COLUMNS.slice(0, 7).map((column) => ({
    difference: `${column}: notNull true → false`,
    kind: "equivalent" as const,
  })),
  {
    // ddl.ts disagrees across dialects (MySQL BIGINT, Postgres INTEGER). The neutral `bigint`
    // makes them agree; on Postgres that is a widening, an ADR 0053 expand step.
    difference: 'build_reference_generations.generation: type "integer" → "bigint"',
    kind: "schema",
  },
  ...PRIMARY_KEY_COLUMNS.slice(7).map((column) => ({
    difference: `${column}: notNull true → false`,
    kind: "equivalent" as const,
  })),
];

/** A json<T> column is TEXT, its default the JSON text. */
const JSON_DDL = /"body" text DEFAULT '\{\}' NOT NULL,\n\t"extra" text\n/u;

async function generatedDdl(): Promise<string> {
  const built = ns.buildAll(ns.NEUTRAL_TABLES, pgTableOf, external);
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
    const projects = pgTableOf(ns.projects, resolve);
    // The hand-written `storybookMeta` is `$type<string | null | undefined>().default(null)`.
    type Unmeta<T> = Omit<T, "storybookMeta">;
    expectTypeOf<Unmeta<typeof projects.$inferSelect>>().toEqualTypeOf<
      Unmeta<typeof schema.projects.$inferSelect>
    >();
    expectTypeOf<(typeof projects.$inferSelect)["storybookMeta"]>().toEqualTypeOf<string | null>();
    expectTypeOf(pgTableOf(ns.projectMembers, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.projectMembers.$inferSelect
    >();
    expectTypeOf(pgTableOf(ns.projectGroupMappings, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.projectGroupMappings.$inferSelect
    >();
    expectTypeOf(pgTableOf(ns.projectLinks, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.projectLinks.$inferSelect
    >();
    expect(Object.keys(builds)).toContain("retentionState");
  });

  it("maps json<T> to TEXT that parses on read", async () => {
    type Doc = { a?: number };
    const docs = ns.defineTable("docs", {
      id: ns.id("id").primaryKey(),
      body: ns.json<Doc>("body").notNull().defaultJson({}),
      extra: ns.json<string[]>("extra"),
    });
    const built = pgTableOf(docs, resolve);
    expectTypeOf(built.$inferSelect).toEqualTypeOf<{
      id: string;
      body: Doc;
      extra: string[] | null;
    }>();
    expectTypeOf(built.$inferSelect).toEqualTypeOf<ns.InferRow<typeof docs>>();
    expect(built.body.mapToDriverValue({ a: 1 })).toBe('{"a":1}');
    expect(built.body.mapFromDriverValue('{"a":1}')).toEqual({ a: 1 });
    const after = await generateDrizzleJson({ docs: built });
    const statements = await generateMigration(await generateDrizzleJson({}), after);
    expect(statements.join("\n")).toMatch(JSON_DDL);
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

  it("leaves foreign-key targets unqualified, as ddl.ts does", async () => {
    // drizzle-kit 0.31 wrote `"public"."projects"`; 1.0 writes the bare name, as ddl.ts does. The
    // adapter never sets a search_path, so every table is in `public` either way.
    expect(await generatedDdl()).toContain('REFERENCES "projects"("id")');
  });
});
