import { describe, expect, expectTypeOf, it } from "vitest";
import { bool, id, int, text } from "./columns.ts";
import { defineTable, index, uniqueIndex, type InferRow } from "./define-table.ts";

const things = defineTable(
  "things",
  { id: id("id").primaryKey(), count: int("count").notNull().default(0), note: text("note") },
  {
    indexes: [
      index("things_count_idx", ["count"]),
      uniqueIndex("things_note_idx", ["note"], "note IS NOT NULL"),
    ],
    primaryKey: { columns: ["id", "count"] },
    checks: [{ name: "things_count_check", sql: "count >= 0" }],
  },
);

describe("defineTable", () => {
  it("keeps the columns and table-level parts", () => {
    expect(things.name).toBe("things");
    expect(Object.keys(things.columns)).toEqual(["id", "count", "note"]);
    expect(things.indexes).toEqual([
      { name: "things_count_idx", columns: ["count"], unique: false },
      { name: "things_note_idx", columns: ["note"], unique: true, where: "note IS NOT NULL" },
    ]);
    expect(things.primaryKey).toEqual({ columns: ["id", "count"] });
    expect(things.checks).toHaveLength(1);
  });

  it("defaults the optional parts", () => {
    const bare = defineTable("bare", { flag: bool("flag") });
    expect(bare).toEqual({ name: "bare", columns: bare.columns, indexes: [], checks: [] });
    expect(index("i", ["flag"], "flag").where).toBe("flag");
    expect(uniqueIndex("u", ["flag"])).not.toHaveProperty("where");
  });

  it("infers the row type", () => {
    expectTypeOf<InferRow<typeof things>>().toEqualTypeOf<{
      id: string;
      count: number;
      note: string | null;
    }>();
  });
});
