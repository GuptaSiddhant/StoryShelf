import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import type { Project } from "@storyshelf/core/schema";
import { asc, desc, eq, getTableColumns, gt } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { createSqliteDatabase } from "./index.ts";
import { schema } from "./schema/index.ts";

const columns = getTableColumns(schema.projects) as Record<string, SQLiteColumn>;
const nameColumn = columns["name"] as SQLiteColumn;
const slugColumn = columns["slug"] as SQLiteColumn;

/** A migrated in-memory database holding projects p1..p5 (names A..E, in that creation order). */
async function seeded(): Promise<DatabaseAdapter> {
  const db = createSqliteDatabase(":memory:");
  await db.lifecycle?.setup({ config: {}, logger: createShelfLogger({ level: "silent" }) });
  await Promise.all(
    ["A", "B", "C", "D", "E"].map(async (name, index) => {
      const at = `2026-01-0${index + 1}T00:00:00.000Z`;
      await db.insert(schema.projects, {
        id: `p${index + 1}`,
        name,
        slug: name.toLowerCase(),
        createdAt: at,
        updatedAt: at,
      });
    }),
  );
  return db;
}

function names(rows: unknown[]): string[] {
  return (rows as Project[]).map((row) => row.name);
}

describe("list options", () => {
  it("returns every row without options", async () => {
    const db = await seeded();
    expect(names(await db.list(schema.projects)).toSorted()).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("filters with where", async () => {
    const db = await seeded();
    expect(names(await db.list(schema.projects, { where: eq(slugColumn, "c") }))).toEqual(["C"]);
    expect(await db.list(schema.projects, { where: eq(slugColumn, "nope") })).toEqual([]);
  });

  it("orders ascending and descending", async () => {
    const db = await seeded();
    expect(names(await db.list(schema.projects, { orderBy: asc(nameColumn) }))).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
    ]);
    expect(names(await db.list(schema.projects, { orderBy: desc(nameColumn) }))).toEqual([
      "E",
      "D",
      "C",
      "B",
      "A",
    ]);
  });

  it("limits and offsets over the order", async () => {
    const db = await seeded();
    const orderBy = asc(nameColumn);
    expect(names(await db.list(schema.projects, { orderBy, limit: 2 }))).toEqual(["A", "B"]);
    expect(names(await db.list(schema.projects, { orderBy, limit: 2, offset: 2 }))).toEqual([
      "C",
      "D",
    ]);
    expect(names(await db.list(schema.projects, { orderBy, limit: 10, offset: 4 }))).toEqual(["E"]);
    expect(await db.list(schema.projects, { orderBy, limit: 0 })).toEqual([]);
  });

  it("combines where, order, limit and offset", async () => {
    const db = await seeded();
    const rows = await db.list(schema.projects, {
      where: gt(nameColumn, "A"),
      orderBy: desc(nameColumn),
      limit: 2,
      offset: 1,
    });
    expect(names(rows)).toEqual(["D", "C"]);
  });

  it("applies the same options inside a transaction", async () => {
    const db = await seeded();
    expect(db.transact).toBeDefined();
    const rows = await db.transact?.(
      async (tx) =>
        await tx.list(schema.projects, {
          orderBy: asc(nameColumn),
          limit: 2,
          offset: 1,
        }),
    );
    expect(names(rows ?? [])).toEqual(["B", "C"]);
  });
});
