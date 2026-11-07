/** The pure helpers of the lifecycle transaction: result shapes, timestamps and bound lists. */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { instant, isoOf, rowsOf, textRows, valueList } from "./lifecycle-transaction.ts";

const dialect = new PgDialect();

describe("rowsOf", () => {
  it("reads postgres.js results, which are the rows themselves", () => {
    expect(rowsOf([{ id: "a" }, { id: "b" }])).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("reads PGlite results, which carry the rows", () => {
    expect(rowsOf({ rows: [{ id: "a" }], fields: [] })).toEqual([{ id: "a" }]);
  });

  it("reads a result without rows as none", () => {
    const result: { rows?: never[] } = {};
    expect(rowsOf(result)).toEqual([]);
    expect(rowsOf(result.rows)).toEqual([]);
  });
});

describe("isoOf", () => {
  it("keeps a missing value missing", () => {
    const row: { at?: Date } = {};
    expect(isoOf(null)).toBeNull();
    expect(isoOf(row.at)).toBeNull();
  });

  it("writes a Date, a string and a number as the same ISO instant", () => {
    const iso = "2026-01-01T00:00:00.000Z";
    expect(isoOf(new Date(iso))).toBe(iso);
    expect(isoOf("2026-01-01T00:00:00Z")).toBe(iso);
    expect(isoOf(Date.parse(iso))).toBe(iso);
  });

  it("refuses a value that is no instant instead of inventing one", () => {
    expect(() => isoOf("not a time")).toThrow(RangeError);
  });
});

describe("bound lists", () => {
  it("binds each value of a list as its own parameter", () => {
    expect(dialect.sqlToQuery(valueList(["a", "b", "c"]))).toMatchObject({
      sql: "$1, $2, $3",
      params: ["a", "b", "c"],
    });
  });

  it("binds a set of any size as one JSON parameter", () => {
    const hashes = Array.from({ length: 70_000 }, (_, index) => `h${index}`);
    const query = dialect.sqlToQuery(textRows(hashes));
    expect(query.sql).toBe("jsonb_array_elements_text($1::jsonb)");
    expect(query.params).toHaveLength(1);
    expect(JSON.parse(String(query.params[0]))).toEqual(hashes);
  });

  it("binds an instant as a timestamptz", () => {
    expect(dialect.sqlToQuery(instant("2026-01-01T00:00:00.000Z"))).toMatchObject({
      sql: "$1::timestamptz",
      params: ["2026-01-01T00:00:00.000Z"],
    });
  });
});
