import * as ns from "@storyshelf/core/db";
/**
 * Spike #800 (ADR 0041 decisions 2 and 3): the neutral tables built by `mysqlTableOf` generate,
 * through drizzle-kit, the same DDL as `ddl.ts` apart from the differences listed and classified
 * below, and infer exactly the hand-written Drizzle row types.
 */
import type { BuildLabel, LabelType, User } from "@storyshelf/core/schema";
import { compareDdlShapes, ddlShape } from "@storyshelf/core/test-helpers";
import { indexStatementsIn } from "@storyshelf/core/test-helpers";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/payload/mysql";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import { DDL } from "./ddl.ts";
import * as schema from "./schema/index.ts";
import { mysqlTableOf } from "./table-factory.ts";

const MIGRATE_SOURCE = readFileSync(fileURLToPath(new URL("migrate.ts", import.meta.url)), "utf8");
/** No neutral table references a hand-written one now that `projects` is neutral. */
const external = {};
const BUILT = ns.buildAll(ns.NEUTRAL_TABLES, mysqlTableOf, external);
const resolve = ns.resolverOf(BUILT);
const resolverOf = (tables: Record<string, unknown>) =>
  ns.resolverOf({ ...BUILT, ...tables } as never);
const TABLES = ns.NEUTRAL_TABLES.map((table) => table.name);

/** Every remaining difference, `today → generated`, with its classification. */
const DIFFERENCES: readonly { difference: string; kind: "equivalent" | "factory" | "schema" }[] = [
  {
    // SQLite's ddl.ts indexes the foreign key; Postgres and MySQL never did. The neutral table
    // indexes it everywhere: a new non-unique index, an ADR 0053 expand step.
    difference: "index user_invite_tokens_user_id_idx: only generated",
    kind: "schema",
  },
];

/** No DEFAULT on a MySQL TEXT column: the json<T> default is applied on insert. */
const JSON_DDL = /`body` text NOT NULL,\n\t`extra` text\n/u;

async function generatedDdl(): Promise<string> {
  const built = ns.buildAll(ns.NEUTRAL_TABLES, mysqlTableOf, external);
  const before = await generateDrizzleJson({});
  const after = await generateDrizzleJson(built);
  return (await generateMigration(before, after)).join(";\n");
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
    const projects = mysqlTableOf(ns.projects, resolve);
    // The hand-written `storybookMeta` is `$type<string | null | undefined>().default(null)`.
    type Unmeta<T> = Omit<T, "storybookMeta">;
    expectTypeOf<Unmeta<typeof projects.$inferSelect>>().toEqualTypeOf<
      Unmeta<typeof schema.projects.$inferSelect>
    >();
    expectTypeOf<(typeof projects.$inferSelect)["storybookMeta"]>().toEqualTypeOf<string | null>();
    expectTypeOf(mysqlTableOf(ns.projectMembers, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.projectMembers.$inferSelect
    >();
    expectTypeOf(mysqlTableOf(ns.projectGroupMappings, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.projectGroupMappings.$inferSelect
    >();
    expectTypeOf(mysqlTableOf(ns.projectLinks, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.projectLinks.$inferSelect
    >();
    expectTypeOf(mysqlTableOf(ns.siteSettings, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.siteSettings.$inferSelect
    >();
    expectTypeOf(mysqlTableOf(ns.schemaMeta, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.schemaMeta.$inferSelect
    >();
    expectTypeOf(mysqlTableOf(ns.tokens, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.tokens.$inferSelect
    >();
    expectTypeOf(mysqlTableOf(ns.userInviteTokens, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.userInviteTokens.$inferSelect
    >();
    expectTypeOf(mysqlTableOf(ns.userConnections, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.userConnections.$inferSelect
    >();
    expectTypeOf(mysqlTableOf(ns.webhooks, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.webhooks.$inferSelect
    >();
    expectTypeOf(mysqlTableOf(ns.notificationChannels, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.notificationChannels.$inferSelect
    >();
    expectTypeOf(mysqlTableOf(ns.notificationSubscriptions, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.notificationSubscriptions.$inferSelect
    >();
    expectTypeOf(mysqlTableOf(ns.captureJobs, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.captureJobs.$inferSelect
    >();
    expectTypeOf(mysqlTableOf(ns.captureAttempts, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.captureAttempts.$inferSelect
    >();
    expectTypeOf(mysqlTableOf(ns.captureLogs, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.captureLogs.$inferSelect
    >();
    expectTypeOf(mysqlTableOf(ns.captureShards, resolve).$inferSelect).toEqualTypeOf<
      typeof schema.captureShards.$inferSelect
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
    const built = mysqlTableOf(docs, resolve);
    expectTypeOf(built.$inferSelect).toEqualTypeOf<{
      id: string;
      body: Doc;
      extra: string[] | null;
    }>();
    expectTypeOf(built.$inferSelect).toEqualTypeOf<ns.InferRow<typeof docs>>();
    expect(built.body.mapToDriverValue({ a: 1 })).toBe('{"a":1}');
    expect(built.body.mapFromDriverValue('{"a":1}')).toEqual({ a: 1 });
    expect(built.body.defaultFn?.()).toEqual({});
    // The insert default is the parsed value, so the driver encodes it once.
    expect(built.body.mapToDriverValue(built.body.defaultFn?.())).toBe("{}");
    expect(built.body.hasDefault).toBe(true);
    const after = await generateDrizzleJson({ docs: built });
    const statements = await generateMigration(await generateDrizzleJson({}), after);
    expect(statements.join("\n")).toMatch(JSON_DDL);
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
