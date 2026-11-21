import { describe, expect, it } from "vitest";
import { applyTableBody, foreignKeyDetail, normaliseCheck } from "./ddl-shape-body.ts";
import type { ShapeTable } from "./ddl-shape.ts";

const empty = (): ShapeTable => ({
  columns: new Map(),
  primaryKey: null,
  uniques: [],
  foreignKeys: [],
  checks: [],
});

describe("CREATE TABLE body", () => {
  it("reads inline constraints", () => {
    const table = applyTableBody(
      empty(),
      "t",
      [
        "id TEXT PRIMARY KEY",
        "email VARCHAR(255) NOT NULL UNIQUE",
        "project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE",
        "kind TEXT NOT NULL DEFAULT 'a' CHECK (kind IN ('a', 'b'))",
        "flag TINYINT(1) NOT NULL DEFAULT 0",
        "n INTEGER",
      ],
      "mysql",
    );
    expect(table.columns.get("id")).toEqual({ type: "text", notNull: true, defaultValue: null });
    expect(table.columns.get("kind")).toEqual({ type: "text", notNull: true, defaultValue: "a" });
    expect(table.columns.get("flag")).toEqual({
      type: "boolean",
      notNull: true,
      defaultValue: "0",
    });
    expect(table.columns.get("n")?.type).toBe("int");
    expect(table.primaryKey).toEqual({ name: "PRIMARY", columns: ["id"], detail: "" });
    expect(table.uniques).toEqual([{ name: "email", columns: ["email"], detail: "" }]);
    expect(table.foreignKeys[0]?.detail).toBe("projects(id) on delete cascade");
    expect(table.checks[0]?.detail).toBe("kind in ('a', 'b')");
  });

  it("reads table-level constraints, named or not", () => {
    const table = applyTableBody(
      empty(),
      "t",
      [
        '"a" text NOT NULL',
        '"b" timestamptz',
        'CONSTRAINT "t_pk" PRIMARY KEY("a","b")',
        "UNIQUE (b)",
        "FOREIGN KEY (`a`) REFERENCES `p`(`id`) ON UPDATE no action ON DELETE restrict",
        "CONSTRAINT \"c\" CHECK (a <> '')",
      ],
      "pg",
    );
    expect(table.columns.get("b")?.type).toBe("timestamp with time zone");
    expect(table.primaryKey).toEqual({ name: "t_pk", columns: ["a", "b"], detail: "" });
    expect(table.uniques[0]?.name).toBe("t_b_key");
    expect(table.foreignKeys[0]).toEqual({
      name: "t_a_fkey",
      columns: ["a"],
      detail: "p(id) on delete restrict",
    });
    expect(table.checks[0]).toEqual({ name: "c", columns: [], detail: "a <> ''" });
  });

  it("normalises references and checks", () => {
    expect(foreignKeyDetail('REFERENCES "public"."builds"("id")')).toEqual({
      columns: [],
      detail: "builds(id) on delete no action",
    });
    expect(normaliseCheck("( Generation  >=  0 )")).toBe("generation >= 0");
  });
});
