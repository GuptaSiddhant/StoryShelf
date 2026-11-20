import { sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { id, int } from "./columns.ts";
import { defineTable, index, uniqueIndex } from "./define-table.ts";
import { resolverOf } from "./dialect-kit.ts";
import { tableExtras, type DialectBuilders } from "./table-extras.ts";

const parents = sqliteTable("parents", { id: sqliteText("id").primaryKey() });

function recordingBuilders(calls: unknown[]): DialectBuilders {
  const indexOf = (kind: string) => (name: string) => ({
    on: (...columns: never[]) => ({
      where: (condition: unknown) => calls.push([kind, name, columns, "where", condition]),
      kind,
      name,
      columns,
    }),
  });
  return {
    index: indexOf("index"),
    uniqueIndex: indexOf("unique"),
    primaryKey: (config) => calls.push(["pk", config]),
    check: (name) => calls.push(["check", name]),
    foreignKey: (config) => ({ onDelete: (action) => calls.push(["fk", config.name, action]) }),
  };
}

const table = defineTable(
  "children",
  {
    parentId: id("parent_id").notNull().references("parents", "id", "cascade"),
    n: int("n").notNull(),
  },
  {
    indexes: [index("children_n_idx", ["n"]), uniqueIndex("children_p_idx", ["parentId"], "n > 0")],
    primaryKey: { columns: ["parentId", "n"] },
    checks: [{ name: "children_n_check", sql: "n >= 0" }],
  },
);

describe("tableExtras", () => {
  it("builds indexes, the primary key, checks and foreign keys with the dialect's names", () => {
    const calls: unknown[] = [];
    const extras = tableExtras({
      table,
      columns: { parentId: "P", n: "N" },
      resolve: resolverOf({ parents }),
      builders: recordingBuilders(calls),
      names: {
        primaryKey: (name) => `${name}_pkey`,
        foreignKey: (name, column) => `${name}_${column}_fkey`,
      },
    });
    expect(extras).toHaveLength(5);
    expect(extras[0]).toMatchObject({ kind: "index", name: "children_n_idx", columns: ["N"] });
    expect((calls[0] as unknown[]).slice(0, 4)).toEqual([
      "unique",
      "children_p_idx",
      ["P"],
      "where",
    ]);
    expect(calls.slice(1)).toEqual([
      ["pk", { name: "children_pkey", columns: ["P", "N"] }],
      ["check", "children_n_check"],
      ["fk", "children_parent_id_fkey", "cascade"],
    ]);
  });

  it("leaves names to the database when the dialect gives none", () => {
    const calls: unknown[] = [];
    tableExtras({
      table,
      columns: { parentId: "P", n: "N" },
      resolve: resolverOf({ parents }),
      builders: recordingBuilders(calls),
      names: { primaryKey: () => null, foreignKey: () => null },
    });
    expect(calls).toContainEqual(["pk", { columns: ["P", "N"] }]);
    expect(calls).toContainEqual(["fk", undefined, "cascade"]);
  });
});
