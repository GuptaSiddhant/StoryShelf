/**
 * The review part of the MySQL upgrade (#269), against a fake server that keeps the columns it
 * is told about: an old database gains the review columns with their definitions, a second run
 * adds nothing, and a table or column made by hand fails with its table and column named. The
 * same upgrade on a real server is `migrate-review.live.test.ts` (gated).
 */
import { describe, expect, it } from "vitest";
import { runMigrations } from "./migrate.ts";

const REVIEW_COLUMNS = [
  "projects.review_enabled",
  "projects.review_approvals",
  "builds.review_cycle",
  "builds.review_requested_cycle",
];

interface FakeColumn {
  table: string;
  column: string;
  type: string;
}

/** A fake server: it answers `information_schema.columns` from its state and applies ADD COLUMN. */
function fakeServer(initial: FakeColumn[] = []) {
  const columns = [...initial];
  const added: string[] = [];
  const run = async (sql: string): Promise<unknown[]> => {
    await Promise.resolve();
    if (sql.includes("data_type AS data_type")) {
      return columns.map((entry) => ({
        table_name: entry.table,
        column_name: entry.column,
        data_type: entry.type,
      }));
    }
    const probe = /table_name = '(?<table>\w+)' AND column_name = '(?<column>\w+)' LIMIT 1/u.exec(
      sql,
    );
    if (probe?.groups) {
      const { table, column } = probe.groups;
      return columns.some((entry) => entry.table === table && entry.column === column)
        ? [{ 1: 1 }]
        : [];
    }
    const alter = /^ALTER TABLE (?<table>\w+) ADD COLUMN (?<column>\w+) (?<def>.+)$/u.exec(sql);
    if (alter?.groups) {
      const { table = "", column = "", def = "" } = alter.groups;
      columns.push({ table, column, type: def.split(/[\s(]/u)[0]?.toLowerCase() ?? "" });
      added.push(`${table}.${column} ${def}`);
    }
    return [];
  };
  return { run, added };
}

describe("the review columns on an old MySQL database", () => {
  it("adds them with their defaults, and a second run adds nothing", async () => {
    const server = fakeServer();
    await runMigrations(server.run);
    const review = server.added.filter((added) =>
      REVIEW_COLUMNS.some((name) => added.startsWith(name)),
    );
    expect(review).toEqual([
      "projects.review_enabled TINYINT(1) NOT NULL DEFAULT 1",
      "projects.review_approvals INT NOT NULL DEFAULT 1",
      "builds.review_cycle INT NOT NULL DEFAULT 0",
      "builds.review_requested_cycle INT NULL",
    ]);

    const before = server.added.length;
    await runMigrations(server.run);
    expect(server.added).toHaveLength(before);
  });

  it("leaves columns that are already there alone", async () => {
    const server = fakeServer([
      { table: "projects", column: "review_enabled", type: "tinyint" },
      { table: "projects", column: "review_approvals", type: "int" },
    ]);
    await runMigrations(server.run);
    expect(server.added.some((added) => added.startsWith("projects.review_"))).toBe(false);
    expect(server.added.some((added) => added.startsWith("builds.review_cycle"))).toBe(true);
  });
});

describe("an upgrade that cannot proceed", () => {
  it("names the table and column of a build_reviews table made outside StoryShelf", async () => {
    const server = fakeServer([
      { table: "build_reviews", column: "id", type: "varchar" },
      { table: "build_reviews", column: "verdict", type: "text" },
    ]);
    await expect(runMigrations(server.run)).rejects.toThrow(
      "table build_reviews has no column build_id",
    );
    expect(server.added).toEqual([]);
  });

  it("names the table, column and type of a review column made by hand", async () => {
    const server = fakeServer([{ table: "projects", column: "review_approvals", type: "text" }]);
    await expect(runMigrations(server.run)).rejects.toThrow(
      "column projects.review_approvals has type text, expected int",
    );
  });
});
