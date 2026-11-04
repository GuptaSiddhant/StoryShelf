import { describe, expect, it } from "vitest";
import { parseTableInfo } from "./table-info.ts";

describe("parseTableInfo", () => {
  it("reads array rows (node:sqlite with returnArrays)", () => {
    const rows = [
      [0, "id", "TEXT", 0, null, 1],
      [1, "n", "integer", 1, "0", 0],
    ];
    expect([...parseTableInfo(rows)]).toEqual([
      ["id", "TEXT"],
      ["n", "INTEGER"],
    ]);
  });

  it("reads object rows (better-sqlite3, bun:sqlite, D1, libSQL)", () => {
    const rows = [
      { cid: 0, name: "id", type: "TEXT" },
      { cid: 1, name: "n", type: "int" },
    ];
    expect([...parseTableInfo(rows)]).toEqual([
      ["id", "TEXT"],
      ["n", "INT"],
    ]);
  });

  it("lower-cases names, as SQLite compares them without regard to case", () => {
    expect([...parseTableInfo([{ name: "BODY", type: "text" }, [0, "User_Id", "TEXT"]])]).toEqual([
      ["body", "TEXT"],
      ["user_id", "TEXT"],
    ]);
  });

  it("gives an empty map for no rows, a column with no type an empty type, and skips what it cannot read", () => {
    expect(parseTableInfo([]).size).toBe(0);
    expect([...parseTableInfo([{ name: "x" }, [0, "y"]])]).toEqual([
      ["x", ""],
      ["y", ""],
    ]);
    expect(parseTableInfo([null, "text", 3, {}]).size).toBe(0);
    expect([...parseTableInfo([{ name: "z", type: 7 }])]).toEqual([["z", ""]]);
  });
});
