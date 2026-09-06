import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import { projects } from "@storyshelf/core/schema";
import { sql } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSqliteDatabase } from "./index.ts";

const silentLogger = createShelfLogger({ level: "silent" });

/** Run the adapter's init hook (migrations live there now). */
async function initDb(db: DatabaseAdapter): Promise<void> {
  await db.lifecycle?.init?.({ config: {}, logger: silentLogger });
}

/** Run the adapter's close hook. */
async function closeDb(db: DatabaseAdapter): Promise<void> {
  await db.lifecycle?.close?.();
}

describe("createSqliteDatabase", () => {
  it("migrates and inserts a project", async () => {
    const db = createSqliteDatabase(":memory:");
    await initDb(db);

    const now = new Date().toISOString();
    const project = await db.insert(projects, {
      id: "p1",
      name: "Demo",
      slug: "demo",
      createdAt: now,
      updatedAt: now,
    });
    expect(project.name).toBe("Demo");

    const found = await db.get(projects, "p1");
    expect(found?.slug).toBe("demo");

    const listed = await db.list(projects);
    expect(listed).toHaveLength(1);

    await closeDb(db);
  });

  it("updates and removes a project", async () => {
    const db = createSqliteDatabase(":memory:");
    await initDb(db);

    await db.insert(projects, {
      id: "p1",
      name: "Demo",
      slug: "demo",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.update(projects, "p1", { name: "Renamed" });
    const renamed = await db.get(projects, "p1");
    expect(renamed?.name).toBe("Renamed");

    await db.remove(projects, "p1");
    const afterRemove = await db.get(projects, "p1");
    expect(afterRemove).toBeNull();

    await closeDb(db);
  });

  it("returns null for a missing id (get miss path)", async () => {
    const db = createSqliteDatabase(":memory:");
    await initDb(db);

    await expect(db.get(projects, "missing")).resolves.toBeNull();

    await closeDb(db);
  });

  it("counts rows and runs raw queries (all path)", async () => {
    const db = createSqliteDatabase(":memory:");
    await initDb(db);

    const now = new Date().toISOString();
    await db.insert(projects, { id: "p1", name: "A", slug: "a", createdAt: now, updatedAt: now });
    await db.insert(projects, { id: "p2", name: "B", slug: "b", createdAt: now, updatedAt: now });

    await expect(db.count(projects)).resolves.toBe(2);
    // Raw SQL has no field metadata, so the proxy returns array rows as-is.
    const rows = await db.all<unknown[]>(sql`select slug from projects order by slug`);
    expect(rows).toEqual([["a"], ["b"]]);

    await closeDb(db);
  });

  it("migrate is idempotent", async () => {
    const db = createSqliteDatabase(":memory:");
    await initDb(db);
    await expect(initDb(db)).resolves.toBeUndefined();

    await closeDb(db);
  });

  it("close is idempotent", async () => {
    const db = createSqliteDatabase(":memory:");
    await initDb(db);
    await closeDb(db);
    await expect(closeDb(db)).resolves.toBeUndefined();
  });

  it("opens file databases in WAL mode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storyshelf-sqlite-"));
    try {
      const db = createSqliteDatabase(join(dir, "shelf.db"));
      await initDb(db);

      const rows = await db.all<unknown[]>(sql`PRAGMA journal_mode`);
      expect(rows[0]?.[0]).toBe("wal");

      await closeDb(db);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
