import { getTableConfig, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  compareCoreRowsWithDrizzle,
  compareDdlWithDrizzle,
  compareRequiredWithDdl,
  indexStatementsIn,
  parseDdl,
  readCoreRowFields,
  typeFamily,
  type GetTableConfig,
} from "./schema-parity.ts";

const tables = {
  widgets: sqliteTable("widgets", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    size: integer("size").notNull().default(3),
    note: text("note"),
  }),
};
const config = getTableConfig as unknown as GetTableConfig;
const DDL = `
CREATE TABLE IF NOT EXISTS widgets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 3,
  note TEXT
);
`;
const run = (ddl: string, allowances = []) =>
  compareDdlWithDrizzle({ ddl, schema: tables, getTableConfig: config, allowances });

describe("parseDdl and typeFamily", () => {
  it("reads columns, nullability, defaults, indexes and quoted names", () => {
    const parsed = parseDdl(
      `${DDL}CREATE UNIQUE INDEX w_idx ON widgets (name, size) WHERE size > 1;\nCREATE TABLE IF NOT EXISTS \`user\` (\n  \`key\` VARCHAR(64) NOT NULL UNIQUE\n);`,
    );
    expect(parsed.tables.get("widgets")?.get("size")).toMatchObject({
      family: "int",
      notNull: true,
      defaultValue: "3",
    });
    expect(parsed.tables.get("user")?.get("key")).toMatchObject({ family: "text", unique: true });
    expect(parsed.indexes.get("w_idx")).toEqual({
      name: "w_idx",
      table: "widgets",
      columns: ["name", "size"],
      unique: true,
      where: "size > 1",
    });
    expect(indexStatementsIn('x("CREATE INDEX a ON t (c)")')).toEqual(["CREATE INDEX a ON t (c)"]);
  });

  it("maps dialect types to families", () => {
    expect(
      [
        "TINYINT(1)",
        "BOOLEAN",
        "timestamp with time zone",
        "DATETIME(3)",
        "DOUBLE PRECISION",
        "JSONB",
      ].map((type) => typeFamily(type)),
    ).toEqual(["bool", "bool", "time", "time", "real", "json"]);
  });
});

describe("compareDdlWithDrizzle", () => {
  it("accepts matching copies", () => {
    expect(run(DDL)).toEqual([]);
  });

  it("fails when a column is removed from the DDL", () => {
    expect(
      run(
        DDL.replace("  note TEXT\n", "").replace(
          "size INTEGER NOT NULL DEFAULT 3,",
          "size INTEGER NOT NULL DEFAULT 3",
        ),
      ),
    ).toEqual(["widgets.note is in Drizzle but not in the DDL"]);
  });

  it("fails on type, nullability and default drift", () => {
    expect(
      run(DDL.replace("name TEXT NOT NULL", "name INTEGER").replace("DEFAULT 3", "DEFAULT 4")),
    ).toEqual([
      expect.stringContaining("widgets.name: DDL type INTEGER"),
      "widgets.name: DDL nullable but Drizzle differs",
      "widgets.size: DDL default 4 but Drizzle 3",
    ]);
  });

  it("reports a stale allowance", () => {
    const stale = [{ table: "gone", reason: "x", issue: "#1" }];
    expect(run(DDL, stale as never)).toEqual(["stale allowance for gone: remove it (#1)"]);
  });
});

describe("compareRequiredWithDdl", () => {
  it("names a missing required table and column", () => {
    const problems = compareRequiredWithDdl("CREATE TABLE IF NOT EXISTS builds (\n  id TEXT\n);");
    expect(problems).toContain("required table build_references is missing from the DDL");
    expect(problems).toContain("required column builds.retention_state is missing from the DDL");
  });
});

describe("core rows", () => {
  const root = join(fileURLToPath(new URL("../../../..", import.meta.url)), ".tmp");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "parity-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    join(dir, "widget.ts"),
    "export interface Widget {\n  id: string;\n  name: string;\n  /** doc */\n  colour?: string | null;\n}\n",
  );
  const input = {
    schemaDir: dir,
    rowTables: { Widget: "widgets" },
    schema: tables,
    getTableConfig: config,
  };

  it("fails when a core row field has no column", () => {
    expect(readCoreRowFields(dir).get("Widget")).toEqual(["id", "name", "colour"]);
    expect(compareCoreRowsWithDrizzle(input)).toEqual([
      "core Widget.colour has no column in widgets",
    ]);
  });

  it("accepts an allowlisted field", () => {
    const allowances = [{ table: "widgets", column: "colour", reason: "x", issue: "#1" }];
    expect(compareCoreRowsWithDrizzle({ ...input, allowances })).toEqual([]);
  });
});
