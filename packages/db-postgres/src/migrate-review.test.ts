/**
 * Upgrades of old Postgres databases to the review schema (#269), on embedded Postgres (PGlite):
 * the schema before any review feature and the schema before review cycles (#449) are migrated
 * twice. The review columns, table and index must appear with their defaults, the rows people
 * saved must not move, and the second run must change nothing.
 */
import { PGlite } from "@electric-sql/pglite";
import { createShelfLogger } from "@storyshelf/core/logger";
import { BuildModel, BuildReviewModel, deriveReviewStatus } from "@storyshelf/core/models";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vite-plus/test";
import { runMigrations } from "./migrate.ts";
import { createPgliteDatabase } from "./pglite.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const silent = createShelfLogger({ level: "silent" });
const FIXTURES = new URL("test-fixtures/", import.meta.url);

function runnerFor(client: PGlite): (sql: string) => Promise<unknown[]> {
  return async (sql) => (await client.exec(sql)).flatMap((result) => result.rows);
}

/** A database holding the old schema and its rows. */
async function oldDatabase(fixture: string): Promise<PGlite> {
  const client = new PGlite();
  await client.exec(readFileSync(new URL(fixture, FIXTURES), "utf8"));
  return client;
}

async function rows<T = Record<string, unknown>>(client: PGlite, sql: string): Promise<T[]> {
  return (await client.query<T>(sql)).rows;
}

/** Everything the second run must leave as it found it: the schema and the rows people saved. */
async function snapshot(client: PGlite) {
  const dump = async (table: string) => await rows(client, `SELECT * FROM ${table} ORDER BY id`);
  return {
    columns: await rows(
      client,
      `SELECT table_name, column_name, data_type, column_default, is_nullable
       FROM information_schema.columns WHERE table_schema = 'public'
       ORDER BY table_name, column_name`,
    ),
    indexes: await rows(
      client,
      "SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname",
    ),
    constraints: await rows(
      client,
      `SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY conname`,
    ),
    projects: await dump("projects"),
    builds: await dump("builds"),
    comments: await dump("comments"),
    reviews: await dump("build_reviews"),
  };
}

describe.each(["pre-review.sql", "pre-449.sql"])("upgrading the %s database", (fixture) => {
  it("adds the review schema with its defaults and a second run changes nothing", async () => {
    const client = await oldDatabase(fixture);
    const run = runnerFor(client);
    await runMigrations(run);
    const first = await snapshot(client);

    const column = (table: string, name: string) =>
      first.columns.find((row) => row["table_name"] === table && row["column_name"] === name);
    expect(column("projects", "review_enabled")).toMatchObject({
      is_nullable: "NO",
      column_default: "true",
    });
    expect(column("projects", "review_approvals")).toMatchObject({
      is_nullable: "NO",
      column_default: "1",
    });
    expect(column("builds", "review_cycle")).toMatchObject({
      is_nullable: "NO",
      column_default: "0",
    });
    expect(column("builds", "review_requested_cycle")).toMatchObject({ is_nullable: "YES" });
    // The reviewer may be unknown (auth off, an admin token): user_id stays nullable and keeps its keys.
    expect(column("build_reviews", "user_id")).toMatchObject({ is_nullable: "YES" });
    const reviewKeys = first.constraints.filter((row) => row["table_name"] === "build_reviews");
    expect(reviewKeys.map((row) => row["definition"])).toEqual(
      expect.arrayContaining([
        "FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE CASCADE",
        "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE",
      ]),
    );
    expect(first.indexes.map((row) => row["indexname"])).toContain("build_reviews_build_id_idx");

    await runMigrations(run);
    expect(await snapshot(client)).toEqual(first);
    await client.close();
  });

  it("keeps the rows people saved and gives new review columns their defaults", async () => {
    const client = await oldDatabase(fixture);
    await runMigrations(runnerFor(client));
    const project = async (id: string) =>
      (
        await rows(
          client,
          `SELECT review_enabled, review_approvals FROM projects WHERE id = '${id}'`,
        )
      )[0];

    expect(await rows(client, "SELECT id, body FROM comments")).toEqual([
      { id: "c1", body: "kept comment" },
    ]);
    expect(
      await rows(client, "SELECT id, status, review_cycle, review_requested_cycle FROM builds"),
    ).toEqual([{ id: "b1", status: "pending", review_cycle: 0, review_requested_cycle: null }]);
    if (fixture === "pre-449.sql") {
      expect(await project("p-custom")).toEqual({ review_enabled: false, review_approvals: 3 });
      expect(await project("p-default")).toEqual({ review_enabled: true, review_approvals: 1 });
      expect(
        await rows(client, "SELECT id, user_id, verdict, body FROM build_reviews ORDER BY id"),
      ).toEqual([
        { id: "r1", user_id: "u1", verdict: "approved", body: "looks good" },
        { id: "r2", user_id: null, verdict: "rejected", body: null },
      ]);
    } else {
      expect(await project("p-custom")).toEqual({ review_enabled: true, review_approvals: 1 });
      expect(await rows(client, "SELECT id FROM build_reviews")).toEqual([]);
    }
    await client.close();
  });

  it("counts approvals and starts a new cycle on a genuine back-to-pending after the upgrade", async () => {
    const client = await oldDatabase(fixture);
    const db = createPgliteDatabase({ client });
    await db.lifecycle?.setup({ config: {}, logger: silent });
    const reviews = new BuildReviewModel(db);
    const project = (await db.get(db.tables.projects, "p-custom")) as { reviewApprovals: number };
    const status = async () =>
      deriveReviewStatus({
        testing: false,
        review: true,
        approvalsRequired: project.reviewApprovals,
        reviews: await reviews.listByBuild("b1"),
      });

    if (fixture === "pre-449.sql") {
      // An approval and an anonymous rejection, three approvals needed.
      expect(await reviews.latestByBuild("b1")).toHaveLength(2);
      expect(await status()).toBe("rejected");
      await reviews.add("b1", null, "approved");
      expect(await status()).toBe("pending");
    } else {
      expect(await status()).toBe("pending");
      await reviews.add("b1", "u1", "approved");
      expect(await status()).toBe("approved");
    }

    const builds = new BuildModel(db);
    await builds.setStatus("b1", "approved");
    expect(await builds.setStatus("b1", "pending")).toMatchObject({ reviewCycle: 1 });
    expect(await builds.setStatus("b1", "pending")).toMatchObject({ reviewCycle: 1 });
    await client.close();
  });
});

describe("an upgrade that cannot proceed", () => {
  it("names the table and column of a build_reviews table made outside StoryShelf", async () => {
    const client = await oldDatabase("pre-449.sql");
    await client.exec(
      "DROP TABLE build_reviews; CREATE TABLE build_reviews (id TEXT PRIMARY KEY, verdict TEXT)",
    );
    await expect(runMigrations(runnerFor(client))).rejects.toThrow(
      "table build_reviews has no column build_id",
    );
    await client.close();
  });

  it("names the table, column and type of a review column made by hand", async () => {
    const client = await oldDatabase("pre-review.sql");
    await client.exec("ALTER TABLE projects ADD COLUMN review_approvals TEXT");
    await expect(runMigrations(runnerFor(client))).rejects.toThrow(
      "column projects.review_approvals has type text, expected integer",
    );
    await client.close();
  });
});
