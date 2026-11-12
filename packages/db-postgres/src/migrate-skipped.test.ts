/**
 * Skipped builds (ADR 0044) on embedded Postgres (PGlite): an old database gains the nullable
 * `builds.skipped_from_build_id` and its index, a second run changes nothing, and a skipped build
 * round-trips through `BuildModel`.
 */
import { PGlite } from "@electric-sql/pglite";
import { createShelfLogger } from "@storyshelf/core/logger";
import { BuildModel } from "@storyshelf/core/models";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { runMigrations } from "./migrate.ts";
import { createPgliteDatabase } from "./pglite.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const silent = createShelfLogger({ level: "silent" });
const FIXTURES = new URL("test-fixtures/", import.meta.url);

describe.each(["pre-review.sql", "pre-449.sql"])("skipped builds on the %s database", (fixture) => {
  it("adds the nullable source column and its index, and round-trips a skipped build", async () => {
    const client = new PGlite();
    await client.exec(readFileSync(new URL(fixture, FIXTURES), "utf8"));
    const run = async (sql: string) => (await client.exec(sql)).flatMap((result) => result.rows);
    await runMigrations(run);
    await runMigrations(run);

    const column = await client.query<{ is_nullable: string }>(
      "SELECT is_nullable FROM information_schema.columns WHERE table_name = 'builds' AND column_name = 'skipped_from_build_id'",
    );
    expect(column.rows).toEqual([{ is_nullable: "YES" }]);
    const indexes = await client.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'builds'",
    );
    expect(indexes.rows.map((row) => row.indexname)).toContain("builds_skipped_from_idx");

    const db = createPgliteDatabase({ client });
    await db.lifecycle?.setup({ config: {}, logger: silent });
    const builds = new BuildModel(db);
    const source = await builds.create("p-custom", { gitSha: "aaaaaaa1111", gitBranch: "main" });
    await builds.setStatus(source.id, "approved");
    const skipped = await builds.createSkipped({
      projectId: "p-custom",
      gitSha: "bbbbbbb2222",
      gitBranch: "main",
      sourceBuildId: source.id,
      changedFiles: ["README.md"],
    });
    expect(await builds.get(skipped.id)).toMatchObject({
      status: "skipped",
      skippedFromBuildId: source.id,
    });
    expect((await builds.skippedFrom(source.id)).map((build) => build.id)).toEqual([skipped.id]);
    expect((await builds.get(source.id))?.skippedFromBuildId).toBeNull();
    await client.close();
  });
});
