/**
 * Published database contract suite for first- and third-party adapters.
 *
 * Structural conformance only (identity, table map, methods, lifecycle
 * rule) — row-level CRUD stays per-package because insert shapes differ per
 * dialect schema. A package proves conformance in one line:
 *
 * ```ts
 * import { databaseContractSuite } from "@storyshelf/core/test-helpers";
 * databaseContractSuite("sqlite", () => createSqliteDatabase(":memory:"));
 * ```
 */
import { asc, desc, getTableColumns, like, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { REQUIRED_TABLE_KEYS } from "../adapters/database.ts";
import { createShelfLogger } from "../logger.ts";

/** Tables every adapter must expose (single-sourced from the contract). */
export const REQUIRED_TABLES = REQUIRED_TABLE_KEYS;

const REQUIRED_METHODS = [
  "insert",
  "update",
  "updateWhere",
  "get",
  "remove",
  "list",
  "count",
  "all",
];

/** Build the adapter under test (sync or async factories both work). */
export type DatabaseFactory = () => DatabaseAdapter | Promise<DatabaseAdapter>;

function idsOf(rows: Record<string, unknown>[]): unknown[] {
  return rows.map((row) => row["id"]);
}

/** Run the database contract against a factory. */
export function databaseContractSuite(label: string, make: DatabaseFactory): void {
  describe(`database contract: ${label}`, () => {
    it("exposes database metadata", async () => {
      const adapter = await make();
      expect(adapter.metadata.category).toBe("database");
      expect(adapter.metadata.kind.length).toBeGreaterThan(0);
    });

    it("exposes the full table map", async () => {
      const adapter = await make();
      const tables = adapter.tables as unknown as Record<string, unknown>;
      for (const table of REQUIRED_TABLES) {
        expect(tables[table], `missing table: ${table}`).toBeDefined();
      }
    });

    it("exposes every CRUD method", async () => {
      const adapter = await make();
      for (const method of REQUIRED_METHODS) {
        expect(typeof (adapter as unknown as Record<string, unknown>)[method]).toBe("function");
      }
    });

    it("conditionally updates and returns the current row when refused", async () => {
      const adapter = await make();
      await adapter.lifecycle?.setup({
        config: {},
        logger: createShelfLogger({ level: "silent" }),
      });
      const table = adapter.tables.projects;
      const id = `conditional-contract-${randomUUID()}`;
      try {
        const now = new Date().toISOString();
        await adapter.insert(table, {
          id,
          name: "before",
          slug: id,
          createdAt: now,
          updatedAt: now,
        });
        const condition = ne(getTableColumns(table)["name"]!, "locked");
        const first = await adapter.updateWhere(table, id, { name: "locked" }, condition);
        expect(first?.["name"]).toBe("locked");
        const refused = await adapter.updateWhere(table, id, { name: "after" }, condition);
        expect(refused?.["name"]).toBe("locked");
        expect((await adapter.get(table, id))?.["name"]).toBe("locked");
        expect(await adapter.updateWhere(table, "missing", { name: "x" }, condition)).toBeNull();
      } finally {
        try {
          await adapter.remove(table, id);
        } finally {
          await adapter.lifecycle?.teardown();
        }
      }
    }, 30_000);

    it("lists in id order, with id as the final tie-break", async () => {
      const adapter = await make();
      await adapter.lifecycle?.setup({
        config: {},
        logger: createShelfLogger({ level: "silent" }),
      });
      const table = adapter.tables.projects;
      const columns = getTableColumns(table);
      const prefix = `order-contract-${randomUUID()}`;
      // Inserted out of id order, with one shared sort key.
      const ids = ["c", "a", "b"].map((suffix) => `${prefix}-${suffix}`);
      try {
        const now = new Date().toISOString();
        await Promise.all(
          ids.map(
            async (id) =>
              await adapter.insert(table, {
                id,
                name: "same",
                slug: id,
                createdAt: now,
                updatedAt: now,
              }),
          ),
        );
        const where = like(columns["id"]!, `${prefix}-%`);
        const sorted = ids.toSorted();
        expect(idsOf(await adapter.list(table, { where }))).toEqual(sorted);
        const byName = await adapter.list(table, { where, orderBy: asc(columns["name"]!) });
        expect(idsOf(byName)).toEqual(sorted);
        const byNameDesc = await adapter.list(table, { where, orderBy: desc(columns["name"]!) });
        expect(idsOf(byNameDesc)).toEqual(sorted);
        const page = await adapter.list(table, { where, limit: 1, offset: 1 });
        expect(idsOf(page)).toEqual([sorted[1]]);
      } finally {
        try {
          await Promise.all(ids.map(async (id) => await adapter.remove(table, id)));
        } finally {
          await adapter.lifecycle?.teardown();
        }
      }
    }, 30_000);

    it("reads only the requested columns, plus id, in the same order", async () => {
      const adapter = await make();
      await adapter.lifecycle?.setup({
        config: {},
        logger: createShelfLogger({ level: "silent" }),
      });
      const table = adapter.tables.projects;
      const columns = getTableColumns(table);
      const prefix = `columns-contract-${randomUUID()}`;
      const ids = ["b", "a"].map((suffix) => `${prefix}-${suffix}`);
      try {
        const now = new Date().toISOString();
        await Promise.all(
          ids.map(
            async (id) =>
              await adapter.insert(table, {
                id,
                name: "same",
                slug: id,
                createdAt: now,
                updatedAt: now,
              }),
          ),
        );
        const where = like(columns["id"]!, `${prefix}-%`);
        const rows = await adapter.list(table, { where, columns: ["slug"] });
        expect(rows.map((row) => Object.keys(row).toSorted())).toEqual([
          ["id", "slug"],
          ["id", "slug"],
        ]);
        expect(idsOf(rows)).toEqual(ids.toSorted());
        await expect(adapter.list(table, { where, columns: ["nope"] })).rejects.toThrow(/nope/u);
      } finally {
        try {
          await Promise.all(ids.map(async (id) => await adapter.remove(table, id)));
        } finally {
          await adapter.lifecycle?.teardown();
        }
      }
    }, 30_000);

    it("keeps the lifecycle rule (absent or all three hooks)", async () => {
      const adapter = await make();
      const lifecycle = adapter.lifecycle as
        | { setup?: unknown; teardown?: unknown; health?: unknown }
        | undefined;
      if (lifecycle === undefined) {
        return;
      }
      expect(typeof lifecycle.setup).toBe("function");
      expect(typeof lifecycle.teardown).toBe("function");
      expect(typeof lifecycle.health).toBe("function");
    });
  });
}
