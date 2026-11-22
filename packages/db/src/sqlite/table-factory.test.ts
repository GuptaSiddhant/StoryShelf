import * as ns from "@storyshelf/core/db";
/**
 * Spike #800 (ADR 0041 decisions 2 and 3): the neutral tables built by `sqliteTableOf` generate,
 * through drizzle-kit, the same DDL as `ddl.ts` apart from the differences listed and classified
 * below, and infer exactly the hand-written Drizzle row types.
 */
import type { BuildLabel, LabelType, User } from "@storyshelf/core/schema";
import { compareDdlShapes, ddlShape } from "@storyshelf/core/test-helpers";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/payload/sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, expectTypeOf, it } from "vitest";
import { DDL, IDENTITY_STATEMENTS } from "./ddl.ts";
import * as schema from "./schema/index.ts";
import { sqliteTableOf } from "./table-factory.ts";

/** No neutral table references a hand-written one now that `projects` is neutral. */
const external = {};
const BUILT = ns.buildAll(ns.NEUTRAL_TABLES, sqliteTableOf, external);
const resolve = ns.resolverOf(BUILT);
const resolverOf = (tables: Record<string, unknown>) =>
  ns.resolverOf({ ...BUILT, ...tables } as never);
const TABLES = ns.NEUTRAL_TABLES.map((table) => table.name);

/**
 * Every remaining difference, `today → generated`, with its classification. None remain: drizzle-kit
 * 1.0 writes a column's UNIQUE inline, as ddl.ts does (0.31 wrote a named unique index).
 */
const DIFFERENCES: readonly { difference: string; kind: "equivalent" | "factory" | "schema" }[] =
  [];

/** A json<T> column is TEXT, its default the JSON text. */
const JSON_DDL = /`body` text DEFAULT '\{\}' NOT NULL,\n\t`extra` text\n/u;

async function generatedDdl(): Promise<string> {
  const built = ns.buildAll(ns.NEUTRAL_TABLES, sqliteTableOf, external);
  const before = await generateDrizzleJson({});
  const after = await generateDrizzleJson(built);
  return (await generateMigration(before, after)).join(";\n");
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
    const projects = sqliteTableOf(ns.projects, resolve);
    // The hand-written `storybookMeta` is `$type<string | null | undefined>().default(null)`.
    type Unmeta<T> = Omit<T, "storybookMeta">;
    expectTypeOf<Unmeta<typeof projects.$inferSelect>>().toEqualTypeOf<
      Unmeta<typeof schema.projects.$inferSelect>
    >();
    expectTypeOf<(typeof projects.$inferSelect)["storybookMeta"]>().toEqualTypeOf<string | null>();
    expectTypeOf(sqliteTableOf(ns.projectMembers, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.projectMembers.$inferSelect
    >();
    expectTypeOf(sqliteTableOf(ns.projectGroupMappings, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.projectGroupMappings.$inferSelect
    >();
    expectTypeOf(sqliteTableOf(ns.projectLinks, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.projectLinks.$inferSelect
    >();
    expectTypeOf(sqliteTableOf(ns.siteSettings, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.siteSettings.$inferSelect
    >();
    expectTypeOf(sqliteTableOf(ns.schemaMeta, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.schemaMeta.$inferSelect
    >();
    expectTypeOf(sqliteTableOf(ns.tokens, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.tokens.$inferSelect
    >();
    expectTypeOf(sqliteTableOf(ns.userInviteTokens, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.userInviteTokens.$inferSelect
    >();
    expectTypeOf(sqliteTableOf(ns.userConnections, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.userConnections.$inferSelect
    >();
    expectTypeOf(sqliteTableOf(ns.webhooks, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.webhooks.$inferSelect
    >();
    expectTypeOf(sqliteTableOf(ns.notificationChannels, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.notificationChannels.$inferSelect
    >();
    expectTypeOf(sqliteTableOf(ns.notificationSubscriptions, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.notificationSubscriptions.$inferSelect
    >();
    expectTypeOf(sqliteTableOf(ns.captureJobs, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.captureJobs.$inferSelect
    >();
    expectTypeOf(sqliteTableOf(ns.captureAttempts, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.captureAttempts.$inferSelect
    >();
    expectTypeOf(sqliteTableOf(ns.captureLogs, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.captureLogs.$inferSelect
    >();
    expectTypeOf(sqliteTableOf(ns.captureShards, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.captureShards.$inferSelect
    >();
    expectTypeOf(sqliteTableOf(ns.buildReviews, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.buildReviews.$inferSelect
    >();
    expectTypeOf(sqliteTableOf(ns.buildComponents, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.buildComponents.$inferSelect
    >();
    expectTypeOf(sqliteTableOf(ns.buildPackageUsage, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.buildPackageUsage.$inferSelect
    >();
    expectTypeOf(sqliteTableOf(ns.contentUses, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.contentUses.$inferSelect
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
    const built = sqliteTableOf(docs, resolve);
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

  it("stores an omitted json<T> default as its JSON text, encoded once", async () => {
    const docs = ns.defineTable("docs", {
      id: ns.id("id").primaryKey(),
      body: ns.json<{ tags: string[] }>("body").notNull().defaultJson({ tags: [] }),
    });
    const built = sqliteTableOf(docs, resolve);
    const client = new DatabaseSync(":memory:");
    const ddl = await generateMigration(
      await generateDrizzleJson({}),
      await generateDrizzleJson({ docs: built }),
    );
    client.exec(ddl.join(";\n"));
    const db = drizzle({ client });
    await db.insert(built).values([{ id: "a" }, { id: "b", body: { tags: ["x"] } }]);
    expect(client.prepare("SELECT id, body FROM docs ORDER BY id").all()).toEqual([
      { id: "a", body: '{"tags":[]}' },
      { id: "b", body: '{"tags":["x"]}' },
    ]);
    expect((await db.select().from(built)).map((row) => row.body)).toEqual([
      { tags: [] },
      { tags: ["x"] },
    ]);
    client.close();
  });

  it("expresses a partial index", async () => {
    const partial = ns.defineTable(
      "partials",
      { id: ns.id("id").primaryKey(), key: ns.key("key", 64) },
      { indexes: [ns.uniqueIndex("partials_key_idx", ["key"], "key IS NOT NULL")] },
    );
    const after = await generateDrizzleJson({ partials: sqliteTableOf(partial, resolve) });
    const statements = await generateMigration(await generateDrizzleJson({}), after);
    expect(statements.join("\n")).toMatch(
      /UNIQUE INDEX .partials_key_idx. .* WHERE key IS NOT NULL/u,
    );
  });
});
