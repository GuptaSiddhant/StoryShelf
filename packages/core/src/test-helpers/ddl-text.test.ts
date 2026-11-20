import { describe, expect, it } from "vitest";
import { identList, splitTopLevel, statementsOf, unquote } from "./ddl-text.ts";

describe("DDL text helpers", () => {
  it("unquotes identifiers in every dialect", () => {
    expect(['"user"', "`key`", " plain "].map((v) => unquote(v))).toEqual(["user", "key", "plain"]);
    expect(identList('`a`, "b",c')).toEqual(["a", "b", "c"]);
  });

  it("splits only on top-level commas", () => {
    expect(splitTopLevel("a TEXT, b INT CHECK (b IN (1, 2)), c TEXT DEFAULT 'x,y'")).toEqual([
      "a TEXT",
      "b INT CHECK (b IN (1, 2))",
      "c TEXT DEFAULT 'x,y'",
    ]);
  });

  it("splits statements and drops comments", () => {
    expect(
      statementsOf("-- note\nCREATE  TABLE a (x TEXT);\n\nINSERT INTO a VALUES ('a;b');"),
    ).toEqual(["CREATE TABLE a (x TEXT)", "INSERT INTO a VALUES ('a;b')"]);
  });
});
