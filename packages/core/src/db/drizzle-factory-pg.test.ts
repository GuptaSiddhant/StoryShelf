import { eq } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "./database.ts";
import { createDrizzlePgAdapter } from "./drizzle-factory-pg.ts";

const widgets = pgTable("widgets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

interface CannedRows {
  returning?: unknown[];
  select?: unknown[];
  count?: number;
  all?: unknown[];
}

/** In-memory stand-in for a Postgres Drizzle dialect instance. */
function fakePgDb(canned: CannedRows = {}): { db: unknown; calls: string[] } {
  const calls: string[] = [];
  const returning = canned.returning ?? [{ id: "w1", name: "Widget" }];
  const select = canned.select ?? [{ id: "w1", name: "Widget" }];
  const db = {
    insert: vi.fn((_table: unknown) => ({
      values: vi.fn((_values: unknown) => ({
        returning: vi.fn(async () => {
          calls.push("insert");
          await Promise.resolve();
          return returning;
        }),
      })),
    })),
    update: vi.fn((_table: unknown) => ({
      set: vi.fn((_values: unknown) => ({
        where: vi.fn((_where: unknown) => ({
          returning: vi.fn(async () => {
            calls.push("update");
            await Promise.resolve();
            return returning;
          }),
        })),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn((_table: unknown) => ({
        where: vi.fn((_where: unknown) => ({
          limit: vi.fn(async (_n: number) => {
            await Promise.resolve();
            return select;
          }),
          orderBy: vi.fn(async (_order: unknown) => {
            await Promise.resolve();
            return select;
          }),
          offset: vi.fn(async (_n: number) => {
            await Promise.resolve();
            return select;
          }),
        })),
        limit: vi.fn(async (_n: number) => {
          await Promise.resolve();
          return select;
        }),
        orderBy: vi.fn(async (_order: unknown) => {
          await Promise.resolve();
          return select;
        }),
        offset: vi.fn(async (_n: number) => {
          await Promise.resolve();
          return select;
        }),
      })),
    })),
    delete: vi.fn((_table: unknown) => ({
      where: vi.fn(async (_where: unknown) => {
        calls.push("delete");
        await Promise.resolve();
      }),
    })),
    $count: vi.fn(async () => {
      calls.push("count");
      await Promise.resolve();
      return canned.count ?? 0;
    }),
    execute: vi.fn(async (_query: SQL) => {
      calls.push("all");
      await Promise.resolve();
      return canned.all ?? [];
    }),
  };
  return { db, calls };
}

function setup(canned?: CannedRows): { adapter: DatabaseAdapter; calls: string[] } {
  const { db, calls } = fakePgDb(canned);
  const adapter = createDrizzlePgAdapter(db, {
    metadata: {
      name: "Test PG",
      version: "0.0.0",
      description: "Fake-backed test adapter",
      kind: "test",
      category: "database",
    },
    migrate: () => {},
    close: () => {},
  });
  return { adapter, calls };
}

describe("createDrizzlePgAdapter", () => {
  it("inserts a row and returns it", async () => {
    const { adapter, calls } = setup();
    const created = await adapter.insert(widgets, { id: "w1", name: "Widget" });
    expect(calls).toEqual(["insert"]);
    expect(created).toEqual({ id: "w1", name: "Widget" });
  });

  it("updates a row and returns it", async () => {
    const { adapter, calls } = setup({
      returning: [{ id: "w1", name: "Renamed" }],
    });
    const updated = await adapter.update(widgets, "w1", { name: "Renamed" });
    expect(calls).toEqual(["update"]);
    expect(updated).toEqual({ id: "w1", name: "Renamed" });
  });

  it("gets a row by id and null on miss", async () => {
    const { adapter } = setup();
    expect(await adapter.get(widgets, "w1")).toEqual({ id: "w1", name: "Widget" });
    const missing = setup({ select: [] });
    expect(await missing.adapter.get(widgets, "nope")).toBeNull();
  });

  it("removes a row", async () => {
    const { adapter, calls } = setup();
    await adapter.remove(widgets, "w1");
    expect(calls).toEqual(["delete"]);
  });

  it("lists and counts rows", async () => {
    const { adapter, calls } = setup({ count: 2 });
    const rows = await adapter.list(widgets, { where: eq(widgets.id, "w1"), limit: 1 });
    expect(rows).toHaveLength(1);
    expect(await adapter.count(widgets)).toBe(2);
    expect(calls).toContain("count");
  });

  it("runs raw SQL via all", async () => {
    const { adapter, calls } = setup({ all: [{ count: "1" }] });
    const rows = await adapter.all<{ count: string }>(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- raw SQL helper
      { queryChunks: [] } as unknown as SQL,
    );
    expect(rows).toEqual([{ count: "1" }]);
    expect(calls).toEqual(["all"]);
  });
});
