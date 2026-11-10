/**
 * Upgrades of old MySQL databases to the review schema (#269), on a real server. Gated like the
 * other live suites, and because it creates and drops a scratch database it also needs
 * `MYSQL_SCHEMA_MUTATION_TEST=1`:
 *
 *   LIVE_CLOUD=1 MYSQL_SCHEMA_MUTATION_TEST=1 MYSQL_DATABASE_URL=mysql://user:pass@host:3306/db
 *
 * The database in the URL is only used to reach the server; the old schema goes into a new
 * scratch database that is dropped afterwards. The hermetic counterpart is `migrate-review.test.ts`.
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import { BuildModel, BuildReviewModel } from "@storyshelf/core/models";
import { createConnection, type Connection } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createMysqlDatabase } from "./index.ts";

const LIVE =
  process.env["LIVE_CLOUD"] === "1" &&
  process.env["MYSQL_SCHEMA_MUTATION_TEST"] === "1" &&
  process.env["MYSQL_DATABASE_URL"] !== undefined;
const silent = createShelfLogger({ level: "silent" });
const FIXTURES = new URL("test-fixtures/", import.meta.url);

describe.skipIf(!LIVE)("review schema upgrade (real MySQL, gated)", () => {
  const scratch = `review_upgrade_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  let admin: Connection | undefined;
  let scratchUrl = "";

  beforeEach(async () => {
    const url = new URL(process.env["MYSQL_DATABASE_URL"] ?? "");
    admin = await createConnection({ uri: url.toString(), multipleStatements: true });
    await admin.query(`CREATE DATABASE ${scratch}`);
    url.pathname = `/${scratch}`;
    scratchUrl = url.toString();
  });

  afterEach(async () => {
    await admin?.query(`DROP DATABASE IF EXISTS ${scratch}`);
    await admin?.end();
  });

  async function upgrade(): Promise<void> {
    const db = createMysqlDatabase({ url: scratchUrl });
    try {
      await db.lifecycle?.setup({ config: {}, logger: silent });
    } finally {
      // The owned pool is released even when the upgrade is refused.
      await db.lifecycle?.teardown();
    }
  }

  async function rows(sql: string): Promise<Record<string, unknown>[]> {
    const [result] = await admin!.query(sql);
    return result as Record<string, unknown>[];
  }

  async function load(fixture: string): Promise<void> {
    await admin!.query(`USE ${scratch}`);
    await admin!.query(readFileSync(new URL(fixture, FIXTURES), "utf8"));
  }

  const shape = async () =>
    await rows(
      `SELECT table_name AS tbl, column_name AS col, column_type AS type, column_default AS dflt, is_nullable AS nullable
       FROM information_schema.columns WHERE table_schema = '${scratch}' ORDER BY 1, 2`,
    );

  describe.each(["pre-review.sql", "pre-449.sql"])("the %s database", (fixture) => {
    it("gains the review schema with its defaults, keeps its rows, and a second run changes nothing", async () => {
      await load(fixture);
      await upgrade();
      const first = await shape();
      const column = (table: string, name: string) =>
        first.find((row) => row["tbl"] === table && row["col"] === name);
      expect(column("projects", "review_enabled")).toMatchObject({ dflt: "1", nullable: "NO" });
      expect(column("projects", "review_approvals")).toMatchObject({ dflt: "1", nullable: "NO" });
      expect(column("builds", "review_cycle")).toMatchObject({ dflt: "0", nullable: "NO" });
      expect(column("builds", "review_requested_cycle")).toMatchObject({ nullable: "YES" });
      expect(column("build_reviews", "user_id")).toMatchObject({ nullable: "YES" });
      const keys = await rows(
        `SELECT constraint_name AS name FROM information_schema.referential_constraints
         WHERE constraint_schema = '${scratch}' AND table_name = 'build_reviews'`,
      );
      expect(keys.map((key) => key["name"])).toEqual(
        expect.arrayContaining(["fk_build_reviews_build_id", "fk_build_reviews_user_id"]),
      );

      const projects = await rows(
        "SELECT id, review_enabled, review_approvals FROM projects ORDER BY id",
      );
      const reviews = await rows("SELECT id, user_id, verdict FROM build_reviews ORDER BY id");
      const comments = await rows("SELECT id, body FROM comments");
      expect(comments).toEqual([{ id: "c1", body: "kept comment" }]);
      if (fixture === "pre-449.sql") {
        expect(projects).toEqual([
          { id: "p-custom", review_enabled: 0, review_approvals: 3 },
          { id: "p-default", review_enabled: 1, review_approvals: 1 },
        ]);
        expect(reviews).toEqual([
          { id: "r1", user_id: "u1", verdict: "approved" },
          { id: "r2", user_id: null, verdict: "rejected" },
        ]);
      } else {
        expect(projects).toEqual([{ id: "p-custom", review_enabled: 1, review_approvals: 1 }]);
        expect(reviews).toEqual([]);
      }

      await upgrade();
      expect(await shape()).toEqual(first);
      expect(
        await rows("SELECT id, review_enabled, review_approvals FROM projects ORDER BY id"),
      ).toEqual(projects);
      expect(await rows("SELECT id, user_id, verdict FROM build_reviews ORDER BY id")).toEqual(
        reviews,
      );
    }, 120_000);
  });

  it("names the table and column of a build_reviews table made outside StoryShelf", async () => {
    await load("pre-449.sql");
    await admin!.query(
      "DROP TABLE build_reviews; CREATE TABLE build_reviews (id VARCHAR(64) PRIMARY KEY, verdict TEXT)",
    );
    await expect(upgrade()).rejects.toThrow("table build_reviews has no column build_id");
  }, 120_000);

  describe("the review lifecycle on the upgraded schema", () => {
    const T0 = "2026-01-01T00:00:00.000Z";

    /** A fresh scratch database, migrated by the adapter, with a project, two builds and a user. */
    async function withSeededDb(run: (db: DatabaseAdapter) => Promise<void>): Promise<void> {
      const db = createMysqlDatabase({ url: scratchUrl });
      try {
        await db.lifecycle?.setup({ config: {}, logger: silent });
        await db.insert(db.tables.projects, {
          id: "p1",
          name: "P",
          slug: "p",
          gitDefaultBranch: "main",
          createdAt: T0,
          updatedAt: T0,
        } as never);
        await Promise.all(
          ["b1", "b2"].map(
            async (id) =>
              await db.insert(db.tables.builds, {
                id,
                projectId: "p1",
                gitSha: id,
                gitBranch: "feature/x",
                createdAt: T0,
                updatedAt: T0,
              } as never),
          ),
        );
        await db.insert(db.tables.users, {
          id: "u1",
          email: "u1@example.com",
          name: "U1",
          role: "member",
          createdAt: T0,
        } as never);
        await run(db);
      } finally {
        await db.lifecycle?.teardown();
      }
    }

    it("lets one of several concurrent claimants win a review cycle, and counts a reopening once", async () => {
      await withSeededDb(async (db) => {
        const builds = new BuildModel(db);
        const claims = await Promise.all(
          Array.from({ length: 5 }, async () => await builds.claimReviewRequest("b1")),
        );
        expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
        expect(claims.find((claim) => claim !== null)).toMatchObject({ reviewCycle: 0 });
        expect(await builds.claimReviewRequest("b1")).toBeNull();

        await builds.setStatus("b1", "approved");
        const moved = await Promise.all([
          builds.setStatus("b1", "pending"),
          builds.setStatus("b1", "pending"),
        ]);
        expect(moved.map((build) => build.status)).toEqual(["pending", "pending"]);
        expect((await builds.setStatus("b1", "pending")).reviewCycle).toBe(1);
        expect(await builds.claimReviewRequest("b1")).toMatchObject({ reviewCycle: 1 });
        expect(await builds.claimReviewRequest("b1")).toBeNull();
      });
    }, 120_000);

    it("drops a build's verdicts with the build and a user's with the user, and keeps an anonymous one", async () => {
      await withSeededDb(async (db) => {
        const reviews = new BuildReviewModel(db);
        await reviews.add("b1", "u1", "approved");
        await reviews.add("b1", null, "approved");
        await reviews.add("b2", "u1", "approved");
        await db.remove(db.tables.builds, "b2");
        expect(await reviews.listByBuild("b2")).toEqual([]);
        expect(await reviews.listByBuild("b1")).toHaveLength(2);
        await db.remove(db.tables.users, "u1");
        expect((await reviews.listByBuild("b1")).map((review) => review.userId)).toEqual([null]);
      });
    }, 120_000);
  });
});
