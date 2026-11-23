import { describe, expect, expectTypeOf, it } from "vitest";
import {
  bigint,
  bool,
  double,
  enumOf,
  id,
  int,
  json,
  key,
  NeutralColumn,
  text,
  timestamp,
} from "./columns.ts";

describe("neutral columns", () => {
  it("describe each logical type", () => {
    expect(id("id").spec).toMatchObject({ kind: "id", name: "id", length: 64, notNull: false });
    expect(id("job_id", 26).spec.length).toBe(26);
    expect(key("status", 32).spec).toMatchObject({ kind: "key", length: 32 });
    expect(enumOf("owner_type", ["a", "b"]).spec).toMatchObject({
      kind: "enum",
      values: ["a", "b"],
      length: 32,
    });
    const makers = [text, int, bigint, double, bool, timestamp, json];
    expect(makers.map((make) => make("c").spec.kind)).toEqual([
      "text",
      "int",
      "bigint",
      "double",
      "bool",
      "timestamp",
      "json",
    ]);
  });

  it("returns a new column from every modifier", () => {
    const base = text("name");
    const full = base.notNull().unique().default("x").references("projects", "id", "cascade");
    expect(base.spec).toMatchObject({ notNull: false, unique: false });
    expect(full.spec).toMatchObject({
      notNull: true,
      unique: true,
      defaultValue: "x",
      references: { table: "projects", column: "id", onDelete: "cascade" },
    });
    expect(id("id").primaryKey().spec).toMatchObject({ primaryKey: true, notNull: true });
    expect(base.$type<"a">()).toBeInstanceOf(NeutralColumn);
  });

  it("stores a json<T> default as its JSON text, and only on a json<T> column", () => {
    const column = json<{ tags: string[] }>("meta").notNull().defaultJson({ tags: [] });
    expect(column.spec.defaultValue).toBe('{"tags":[]}');
    expectTypeOf(column).toEqualTypeOf<NeutralColumn<{ tags: string[] }, true, true>>();
    expect(() => text("name").defaultJson("x")).toThrow("defaultJson on text column name");
    // `JSON.stringify` returns `undefined` for a value with no JSON form; that is refused.
    expect(() => json<symbol>("meta").defaultJson(Symbol("x"))).toThrow("must have a JSON form");
  });

  it("tracks the row type, nullability and default in the type", () => {
    expectTypeOf(text("a")).toEqualTypeOf<NeutralColumn<string>>();
    expectTypeOf(bool("a").notNull().default(true)).toEqualTypeOf<
      NeutralColumn<boolean, true, true>
    >();
    expectTypeOf(enumOf("a", ["x", "y"])).toEqualTypeOf<NeutralColumn<"x" | "y">>();
    expectTypeOf(key("a", 8).$type<"p" | "q">().notNull()).toEqualTypeOf<
      NeutralColumn<"p" | "q", true>
    >();
  });
});
