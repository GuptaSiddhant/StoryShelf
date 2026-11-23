/**
 * Upgrades of old SQLite databases to the review schema (#269): the schema before any review
 * feature and the schema before review cycles (#449) are opened by the adapter twice. The review
 * columns, table and index must appear with their defaults, the rows people saved must not move,
 * and the second open must change nothing.
 */
import { createShelfLogger } from "@storyshelf/core/logger";
import { BuildModel, BuildReviewModel, deriveReviewStatus } from "@storyshelf/core/models";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteDatabase } from "./index.ts";

const silent = createShelfLogger({ level: "silent" });
const FIXTURES = new URL("test-fixtures/", import.meta.url);

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-review-upgrade-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A database file holding the old schema and its rows. */
function oldDatabase(fixture: string): string {
  const path = join(dir, "old.db");
  const sqlite = new DatabaseSync(path);
  sqlite.exec(readFileSync(new URL(fixture, FIXTURES), "utf8"));
  sqlite.close();
  return path;
}

/** Open the adapter on the file (running its migrations), then close it. */
async function openOnce(path: string): Promise<void> {
  const db = createSqliteDatabase(path);
  await db.lifecycle?.setup({ config: {}, logger: silent });
  await db.lifecycle?.teardown();
}

interface Column {
  name: string;
  notnull: number;
  dflt_value: string | null;
}

/** Read the file with a plain connection: columns, foreign keys, indexes, schema text and rows. */
function inspect(path: string) {
  const sqlite = new DatabaseSync(path, { readOnly: true });
  const all = (sql: string) => sqlite.prepare(sql).all() as Record<string, unknown>[];
  const columns = Object.fromEntries(
    ["projects", "builds", "build_reviews"].map((table) => [
      table,
      all(`PRAGMA table_info(${table})`) as unknown as Column[],
    ]),
  );
  const result = {
    column: (table: string, name: string) => columns[table]?.find((col) => col.name === name),
    foreignKeys: all("PRAGMA foreign_key_list(build_reviews)"),
    indexes: all("PRAGMA index_list(build_reviews)").map((row) => row["name"]),
    schema: all("SELECT type, name, sql FROM sqlite_master ORDER BY type, name"),
    rows: {
      projects: all("SELECT * FROM projects ORDER BY id"),
      builds: all("SELECT * FROM builds ORDER BY id"),
      comments: all("SELECT * FROM comments ORDER BY id"),
      reviews: sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'build_reviews'").get()
        ? all("SELECT * FROM build_reviews ORDER BY id")
        : [],
    },
  };
  sqlite.close();
  return result;
}

describe.each(["pre-review.sql", "pre-449.sql"])("upgrading the %s database", (fixture) => {
  it("adds the review schema with its defaults and a second open changes nothing", async () => {
    const path = oldDatabase(fixture);
    await openOnce(path);
    const first = inspect(path);

    expect(first.column("projects", "review_enabled")).toMatchObject({
      notnull: 1,
      dflt_value: "1",
    });
    expect(first.column("projects", "review_approvals")).toMatchObject({
      notnull: 1,
      dflt_value: "1",
    });
    expect(first.column("builds", "review_cycle")).toMatchObject({ notnull: 1, dflt_value: "0" });
    expect(first.column("builds", "review_requested_cycle")).toMatchObject({ notnull: 0 });
    // The reviewer may be unknown (auth off, an admin token): user_id stays nullable and keeps its keys.
    expect(first.column("build_reviews", "user_id")).toMatchObject({ notnull: 0 });
    expect(
      first.foreignKeys.map(
        (key) => `${String(key["from"])}->${String(key["table"])}.${String(key["to"])}`,
      ),
    ).toEqual(expect.arrayContaining(["build_id->builds.id", "user_id->users.id"]));
    expect(first.indexes).toContain("build_reviews_build_id_idx");

    await openOnce(path);
    const second = inspect(path);
    expect(second.schema).toEqual(first.schema);
    expect(second.rows).toEqual(first.rows);
  });

  it("keeps the rows people saved and gives new review columns their defaults", async () => {
    const path = oldDatabase(fixture);
    await openOnce(path);
    const { rows } = inspect(path);
    const project = (id: string) => rows.projects.find((row) => row["id"] === id);

    expect(rows.comments).toMatchObject([{ id: "c1", body: "kept comment" }]);
    expect(rows.builds).toMatchObject([{ id: "b1", status: "pending", review_cycle: 0 }]);
    expect(rows.builds[0]?.["review_requested_cycle"]).toBeNull();
    if (fixture === "pre-449.sql") {
      expect(project("p-custom")).toMatchObject({ review_enabled: 0, review_approvals: 3 });
      expect(project("p-default")).toMatchObject({ review_enabled: 1, review_approvals: 1 });
      expect(rows.reviews).toMatchObject([
        { id: "r1", user_id: "u1", verdict: "approved", body: "looks good" },
        { id: "r2", user_id: null, verdict: "rejected", body: null },
      ]);
    } else {
      expect(project("p-custom")).toMatchObject({ review_enabled: 1, review_approvals: 1 });
      expect(rows.reviews).toEqual([]);
    }
  });

  it("counts approvals and starts a new cycle on a genuine back-to-pending after the upgrade", async () => {
    const path = oldDatabase(fixture);
    const db = createSqliteDatabase(path);
    await db.lifecycle?.setup({ config: {}, logger: silent });
    const reviews = new BuildReviewModel(db);
    const project = (await db.get(db.tables.projects, "p-custom")) as {
      reviewEnabled: boolean;
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
    await db.lifecycle?.teardown();
  });
});

describe("an upgrade that cannot proceed", () => {
  it("names the table and column of a build_reviews table made outside StoryShelf", async () => {
    const path = oldDatabase("pre-449.sql");
    const sqlite = new DatabaseSync(path);
    sqlite.exec(
      "DROP TABLE build_reviews; CREATE TABLE build_reviews (id TEXT PRIMARY KEY, verdict TEXT)",
    );
    sqlite.close();
    await expect(openOnce(path)).rejects.toThrow(/build_reviews.*build_id/u);
  });
});

describe("a review column made by hand", () => {
  it("names the table, column and type when the type cannot hold the setting", async () => {
    const path = oldDatabase("pre-review.sql");
    const sqlite = new DatabaseSync(path);
    sqlite.exec("ALTER TABLE projects ADD COLUMN review_approvals TEXT");
    sqlite.close();
    await expect(openOnce(path)).rejects.toThrow(/projects\.review_approvals.*TEXT.*INTEGER/u);
  });

  it("leaves a database that already matches alone", async () => {
    const path = oldDatabase("pre-449.sql");
    await openOnce(path);
    await expect(openOnce(path)).resolves.toBeUndefined();
  });
});
