/**
 * Upgrades of old Postgres databases to the review schema (#269), on a real server. The same two
 * fixtures as `migrate-review.test.ts` (PGlite), gated like the other live suites. Because it
 * creates and drops a scratch database it also needs `POSTGRES_SCHEMA_MUTATION_TEST=1`:
 *
 *   LIVE_CLOUD=1 POSTGRES_SCHEMA_MUTATION_TEST=1 DATABASE_URL=postgres://user:pass@host:5432/db
 *
 * The database in the URL is only used to reach the server; the old schema goes into a new scratch
 * database that is dropped afterwards (the role needs `CREATEDB`).
 */
import { createShelfLogger } from "@storyshelf/core/logger";
import { BuildModel, BuildReviewModel, deriveReviewStatus } from "@storyshelf/core/models";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPostgresDatabase } from "./index.ts";

const LIVE =
  process.env["LIVE_CLOUD"] === "1" &&
  process.env["POSTGRES_SCHEMA_MUTATION_TEST"] === "1" &&
  process.env["DATABASE_URL"] !== undefined;
const silent = createShelfLogger({ level: "silent" });
const FIXTURES = new URL("test-fixtures/", import.meta.url);

describe.skipIf(!LIVE)("review schema upgrade (real Postgres, gated)", () => {
  const scratch = `review_upgrade_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  let admin: postgres.Sql | undefined;
  let scratchUrl = "";
  /** A connection to the scratch database, for loading fixtures and reading back. */
  let inside: postgres.Sql | undefined;

  beforeEach(async () => {
    const url = new URL(process.env["DATABASE_URL"] ?? "");
    admin = postgres(url.toString(), { max: 1 });
    await admin.unsafe(`CREATE DATABASE ${scratch}`);
    url.pathname = `/${scratch}`;
    scratchUrl = url.toString();
    inside = postgres(scratchUrl, { max: 1 });
  });

  afterEach(async () => {
    await inside?.end({ timeout: 5 });
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
    await admin?.end({ timeout: 5 });
  });

  async function upgrade(): Promise<void> {
    const db = createPostgresDatabase({ url: scratchUrl, max: 2 });
    try {
      await db.lifecycle?.setup({ config: {}, logger: silent });
    } finally {
      // The owned pool is released even when the upgrade is refused.
      await db.lifecycle?.teardown();
    }
  }

  async function rows(sql: string): Promise<Record<string, unknown>[]> {
    const result = await inside!.unsafe(sql);
    return [...result];
  }

  async function load(fixture: string): Promise<void> {
    await inside!.unsafe(readFileSync(new URL(fixture, FIXTURES), "utf8"));
  }

  /** The schema and every row people saved, as the second run must leave them. */
  async function snapshot() {
    const dump = async (table: string) => await rows(`SELECT * FROM ${table} ORDER BY id`);
    return {
      columns: await rows(
        `SELECT table_name, column_name, data_type, column_default, is_nullable
         FROM information_schema.columns WHERE table_schema = 'public'
         ORDER BY table_name, column_name`,
      ),
      indexes: await rows(
        "SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname",
      ),
      constraints: await rows(
        `SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY conname`,
      ),
      projects: await dump("projects"),
      builds: await dump("builds"),
      comments: await dump("comments"),
      reviews: await dump("build_reviews"),
    };
  }

  describe.each(["pre-review.sql", "pre-449.sql"])("the %s database", (fixture) => {
    it("gains the review schema with its defaults, keeps its rows, and a second run changes nothing", async () => {
      await load(fixture);
      await upgrade();
      const first = await snapshot();
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
      expect(column("build_reviews", "user_id")).toMatchObject({ is_nullable: "YES" });
      const reviewKeys = first.constraints.filter((row) => row["table_name"] === "build_reviews");
      expect(reviewKeys.map((row) => row["definition"])).toEqual(
        expect.arrayContaining([
          "FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE CASCADE",
          "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE",
        ]),
      );
      expect(first.indexes.map((row) => row["indexname"])).toContain("build_reviews_build_id_idx");

      expect(first.comments).toMatchObject([{ id: "c1", body: "kept comment" }]);
      if (fixture === "pre-449.sql") {
        expect(first.projects).toMatchObject([
          { id: "p-custom", review_enabled: false, review_approvals: 3 },
          { id: "p-default", review_enabled: true, review_approvals: 1 },
        ]);
        expect(first.reviews).toMatchObject([
          { id: "r1", user_id: "u1", verdict: "approved", body: "looks good" },
          { id: "r2", user_id: null, verdict: "rejected", body: null },
        ]);
      } else {
        expect(first.projects).toMatchObject([
          { id: "p-custom", review_enabled: true, review_approvals: 1 },
        ]);
        expect(first.reviews).toEqual([]);
      }

      await upgrade();
      expect(await snapshot()).toEqual(first);
    }, 120_000);

    it("counts approvals and starts a new cycle on a genuine back-to-pending after the upgrade", async () => {
      await load(fixture);
      const db = createPostgresDatabase({ url: scratchUrl, max: 2 });
      try {
        await db.lifecycle?.setup({ config: {}, logger: silent });
        const reviews = new BuildReviewModel(db);
        const project = (await db.get(db.tables.projects, "p-custom")) as {
          reviewApprovals: number;
        };
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
      } finally {
        await db.lifecycle?.teardown();
      }
    }, 120_000);
  });

  it("names the table and column of a build_reviews table made outside StoryShelf", async () => {
    await load("pre-449.sql");
    await inside!.unsafe(
      "DROP TABLE build_reviews; CREATE TABLE build_reviews (id TEXT PRIMARY KEY, verdict TEXT)",
    );
    await expect(upgrade()).rejects.toThrow("table build_reviews has no column build_id");
  }, 120_000);

  it("names the table, column and type of a review column made by hand", async () => {
    await load("pre-review.sql");
    await inside!.unsafe("ALTER TABLE projects ADD COLUMN review_approvals TEXT");
    await expect(upgrade()).rejects.toThrow(
      "column projects.review_approvals has type text, expected integer",
    );
  }, 120_000);
});
