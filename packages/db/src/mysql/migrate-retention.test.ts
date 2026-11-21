/**
 * The retention schema (ADR 0039) on an old MySQL database, against a fake server: the expand step
 * (ADR 0053) adds `builds.retention_state` with a constant default and creates the four lifecycle
 * tables, and a second run adds nothing again. The round trip on a real server is the gated
 * `build-reference-lifecycle.live.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { DDL } from "./ddl.ts";
import { FOREIGN_KEYS } from "./foreign-keys.ts";
import { runMigrations } from "./migrate.ts";

const TABLES = [
  "build_references",
  "build_reference_generations",
  "build_deletions",
  "build_content_releases",
];

describe("the retention schema on an old MySQL database", () => {
  it("adds the column with its default and creates the lifecycle tables, once", async () => {
    const columns = new Set<string>();
    const statements: string[] = [];
    const run = async (sql: string): Promise<unknown[]> => {
      await Promise.resolve();
      statements.push(sql);
      const added = /^ALTER TABLE (?<table>\w+) ADD COLUMN (?<column>\w+)/u.exec(sql)?.groups;
      if (added) columns.add(`${added["table"]}.${added["column"]}`);
      const probe = /table_name = '(?<table>\w+)' AND column_name = '(?<column>\w+)' LIMIT 1/u.exec(
        sql,
      )?.groups;
      if (probe) return columns.has(`${probe["table"]}.${probe["column"]}`) ? [{ 1: 1 }] : [];
      return [];
    };
    await runMigrations(run);
    const addColumn =
      "ALTER TABLE builds ADD COLUMN retention_state VARCHAR(16) NOT NULL DEFAULT 'available'";
    expect(statements.filter((sql) => sql === addColumn)).toHaveLength(1);
    for (const table of TABLES) {
      expect(
        statements.some((sql) => sql.startsWith(`CREATE TABLE IF NOT EXISTS ${table} (`)),
      ).toBe(true);
    }

    statements.length = 0;
    await runMigrations(run);
    expect(statements).not.toContain(addColumn);
  });

  it("keeps a pinned build alive: the pin's build key restricts, every other lifecycle key cascades", () => {
    expect(DDL).toContain("retention_state VARCHAR(16) NOT NULL DEFAULT 'available',");
    const lifecycle = FOREIGN_KEYS.filter((key) => TABLES.includes(key.table));
    expect(lifecycle).toHaveLength(6);
    const restricted = lifecycle.filter((key) => key.onDelete === "RESTRICT");
    expect(restricted.map((key) => key.name)).toEqual(["fk_build_references_build_id"]);
    expect(DDL).toContain(
      "CONSTRAINT fk_build_references_build_id FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE RESTRICT",
    );
  });
});
