/**
 * Skipped builds (ADR 0044) on MySQL, against a fake server: an old database gains the nullable
 * `builds.skipped_from_build_id` and the `builds_skipped_from_idx` index, and a second run adds
 * neither again. The round trip on a real server is the gated live suites.
 */
import { describe, expect, it } from "vitest";
import { DDL } from "./ddl.ts";
import { runMigrations } from "./migrate.ts";

describe("the skipped-build column on an old MySQL database", () => {
  it("adds the nullable column and its index, once", async () => {
    const columns = new Set<string>();
    const indexes = new Set<string>();
    const statements: string[] = [];
    const run = async (sql: string): Promise<unknown[]> => {
      await Promise.resolve();
      statements.push(sql);
      const added = /^ALTER TABLE (?<table>\w+) ADD COLUMN (?<column>\w+)/u.exec(sql)?.groups;
      if (added) columns.add(`${added["table"]}.${added["column"]}`);
      const created = /^CREATE INDEX (?<name>\w+) ON/u.exec(sql)?.groups;
      if (created) indexes.add(created["name"] ?? "");
      const probe = /table_name = '(?<table>\w+)' AND column_name = '(?<column>\w+)' LIMIT 1/u.exec(
        sql,
      )?.groups;
      if (probe) {
        return columns.has(`${probe["table"]}.${probe["column"]}`) ? [{ 1: 1 }] : [];
      }
      const named = /index_name = '(?<name>\w+)'/u.exec(sql)?.groups?.["name"];
      return named !== undefined && indexes.has(named) ? [{ 1: 1 }] : [];
    };
    await runMigrations(run);
    expect(statements).toContain(
      "ALTER TABLE builds ADD COLUMN skipped_from_build_id VARCHAR(26) NULL",
    );
    expect(indexes).toContain("builds_skipped_from_idx");

    const writes = () => statements.filter((sql) => /^(?:ALTER|CREATE)\b.*skipped_from/u.test(sql));
    const before = writes().length;
    expect(before).toBe(2);
    await runMigrations(run);
    expect(writes()).toHaveLength(before);
  });

  it("is part of a fresh database's builds table", () => {
    expect(DDL).toContain("skipped_from_build_id VARCHAR(26),");
  });
});
