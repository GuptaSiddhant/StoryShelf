import { describe, expect, it } from "vitest";
import { nameConstraints } from "./ddl-names.ts";
import type { ShapeTable } from "./ddl-shape.ts";

const unnamed = (columns: string[], detail = "") => ({ name: "", columns, detail });

function table(): ShapeTable {
  return {
    columns: new Map(),
    primaryKey: unnamed(["id"]),
    uniques: [unnamed(["email"]), { name: "named_idx", columns: ["a"], detail: "" }],
    foreignKeys: [unnamed(["project_id"], "projects(id) on delete cascade")],
    checks: [unnamed(["kind"], "kind in ('a')"), unnamed([], "n >= 0")],
  };
}

const nameOf = (constraint: { name: string }) => constraint.name;
const names = (shape: ShapeTable) => ({
  pk: shape.primaryKey?.name,
  uniques: shape.uniques.map(nameOf),
  fks: shape.foreignKeys.map(nameOf),
  checks: shape.checks.map(nameOf),
});

describe("implicit constraint names", () => {
  it("uses Postgres's naming rules", () => {
    const named = nameConstraints(table(), "users", "pg");
    expect(names(named)).toEqual({
      pk: "users_pkey",
      uniques: ["users_email_key", "named_idx"],
      fks: ["users_project_id_fkey"],
      checks: ["users_kind_check", "users_check"],
    });
  });

  it("uses MySQL's naming rules", () => {
    const named = nameConstraints(table(), "users", "mysql");
    expect(names(named)).toEqual({
      pk: "PRIMARY",
      uniques: ["email", "named_idx"],
      fks: ["users_ibfk_1"],
      checks: ["users_chk_1", "users_chk_2"],
    });
  });

  it("ignores the names SQLite never uses", () => {
    const named = nameConstraints(table(), "users", "sqlite");
    expect(names(named)).toEqual({
      pk: "-",
      uniques: ["sqlite_autoindex_users_1", "named_idx"],
      fks: ["-"],
      checks: ["-", "-"],
    });
  });

  it("keeps a table without a primary key", () => {
    expect(nameConstraints({ ...table(), primaryKey: null }, "t", "mysql").primaryKey).toBeNull();
    expect(nameConstraints({ ...table(), primaryKey: null }, "t", "sqlite").primaryKey).toBeNull();
    expect(nameConstraints({ ...table(), primaryKey: null }, "t", "pg").primaryKey).toBeNull();
  });
});
