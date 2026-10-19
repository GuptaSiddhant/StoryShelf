import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { col } from "./columns.ts";

describe("col", () => {
  it("returns the column handle for a property", () => {
    const { db } = makeDatabase();
    expect(() => eq(col(db.tables.projects, "slug"), "x")).not.toThrow();
    expect(col(db.tables.projects, "slug")).toBe(col(db.tables.projects, "slug"));
  });

  it("throws on an unknown column", () => {
    const { db } = makeDatabase();
    expect(() => col(db.tables.projects, "nope")).toThrow('Unknown column "nope"');
  });
});
