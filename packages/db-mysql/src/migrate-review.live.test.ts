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
import { createShelfLogger } from "@storyshelf/core/logger";
import { createConnection, type Connection } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});
