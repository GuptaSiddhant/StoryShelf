import { describe, expect, it, vi } from "vitest";
import { makeDatabase } from "../test-helpers/fake-database.ts";
import {
  decideMigration,
  gatedMigration,
  normalizeRelease,
  SchemaTooNewError,
  sqlSchemaLevelStore,
  type SchemaLevelStore,
} from "./schema-level.ts";

describe("decideMigration", () => {
  it.each([
    ["0.12.0", null, "migrate"],
    ["0.12.0", "garbage", "migrate"],
    ["0.12.0", "0.11.5", "migrate"],
    ["0.12.0", "0.12.9", "migrate"],
    ["0.12.7", "0.12.0", "migrate"],
    ["0.12.0", "0.13.0", "skip"],
    ["0.12.0", "0.13.8", "skip"],
    ["0.12.0", "0.14.0", "refuse"],
    ["0.12.0", "1.0.0", "refuse"],
    ["1.0.0", "0.14.0", "migrate"],
    ["0.0.0", "0.14.0", "migrate"],
    ["dev", "0.14.0", "migrate"],
  ] as const)("own %s, database %s: %s", (own, recorded, expected) => {
    expect(decideMigration(own, recorded)).toBe(expected);
  });
});

describe("normalizeRelease", () => {
  it("keeps major.minor.patch and rejects the rest", () => {
    expect(normalizeRelease("0.12.3-beta.1")).toBe("0.12.3");
    expect(normalizeRelease("0.12")).toBeNull();
    expect(normalizeRelease(null)).toBeNull();
  });
});

function run(rows: unknown[][]): () => Promise<unknown[]> {
  const queue = [...rows];
  return async () => queue.shift() ?? [];
}

async function noop(): Promise<void> {}

async function boom(): Promise<void> {
  throw new Error("boom");
}

/** A store over the fake database's `schema_meta` table. */
function fakeStore(): { store: SchemaLevelStore; rows: () => Promise<unknown[]> } {
  const { db } = makeDatabase();
  const table = db.tables.schemaMeta;
  return {
    rows: async () => await db.list(table),
    store: {
      read: async () =>
        ((await db.get(table, "schema")) as { version: string } | null)?.version ?? null,
      write: async (version) => {
        const at = "2026-11-13T00:00:00.000Z";
        await db.remove(table, "schema");
        await db.insert(table, { id: "schema", version, migratedAt: at });
      },
    },
  };
}

describe("gatedMigration on the fake", () => {
  it("migrates and records when no row exists", async () => {
    const { store, rows } = fakeStore();
    const migrate = vi.fn(noop);
    expect(await gatedMigration({ release: "0.12.1", store, migrate })).toBe("migrate");
    expect(migrate).toHaveBeenCalledOnce();
    expect(await rows()).toHaveLength(1);
    expect(await store.read()).toBe("0.12.1");
  });

  it("skips one minor newer without migrating or writing", async () => {
    const { store } = fakeStore();
    await store.write("0.13.2");
    const migrate = vi.fn(noop);
    const info = vi.fn();
    const logger = { info } as never;
    expect(await gatedMigration({ release: "0.12.1", store, migrate, logger })).toBe("skip");
    expect(migrate).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledOnce();
    expect(await store.read()).toBe("0.13.2");
  });

  it("refuses more than one minor newer, naming both versions", async () => {
    const { store } = fakeStore();
    await store.write("0.14.0");
    const migrate = vi.fn(noop);
    const attempt = gatedMigration({ release: "0.12.1", store, migrate });
    await expect(attempt).rejects.toThrow(SchemaTooNewError);
    await expect(attempt).rejects.toThrow(/0\.12\.1.*0\.14\.0/u);
    expect(migrate).not.toHaveBeenCalled();
  });

  it("migrates without touching the record when the release is unknown", async () => {
    const { store } = fakeStore();
    await store.write("0.14.0");
    const migrate = vi.fn(noop);
    expect(await gatedMigration({ release: undefined, store, migrate })).toBe("migrate");
    expect(migrate).toHaveBeenCalledOnce();
    expect(await store.read()).toBe("0.14.0");
  });

  it("does not write when the migration throws", async () => {
    const { store } = fakeStore();
    await expect(gatedMigration({ release: "0.12.1", store, migrate: boom })).rejects.toThrow(
      "boom",
    );
    expect(await store.read()).toBeNull();
  });
});

describe("sqlSchemaLevelStore", () => {
  it.each([
    ["sqlite", "ON CONFLICT (id)", "2026-11-13T01:02:03.004Z"],
    ["postgres", "ON CONFLICT (id)", "2026-11-13T01:02:03.004Z"],
    ["mysql", "ON DUPLICATE KEY UPDATE", "2026-11-13 01:02:03.004"],
  ] as const)("writes a %s upsert", async (dialect, tail, at) => {
    const sent: string[] = [];
    const store = sqlSchemaLevelStore(
      async (sql) => {
        sent.push(sql);
        return [];
      },
      dialect,
      () => new Date("2026-11-13T01:02:03.004Z"),
    );
    await store.write("0.12.3");
    expect(sent[0]).toContain(tail);
    expect(sent[0]).toContain(`'0.12.3', '${at}'`);
  });

  it("reads null without the table, and object or array rows with it", async () => {
    expect(await sqlSchemaLevelStore(run([[]]), "sqlite").read()).toBeNull();
    expect(await sqlSchemaLevelStore(run([[{ found: null }]]), "postgres").read()).toBeNull();
    expect(await sqlSchemaLevelStore(run([[["schema_meta"]], [["0.12.0"]]]), "sqlite").read()).toBe(
      "0.12.0",
    );
    expect(
      await sqlSchemaLevelStore(
        run([[{ found: "schema_meta" }], [{ version: "0.13.1" }]]),
        "mysql",
      ).read(),
    ).toBe("0.13.1");
    expect(await sqlSchemaLevelStore(run([[{ found: "x" }], []]), "mysql").read()).toBeNull();
  });
});
