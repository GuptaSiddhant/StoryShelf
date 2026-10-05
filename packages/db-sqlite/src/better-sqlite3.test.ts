import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import type { Project } from "@storyshelf/core/schema";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBetterSqlite3Database } from "./better-sqlite3.ts";
import { schema } from "./schema/index.ts";

const silentLogger = createShelfLogger({ level: "silent" });

/** Run the adapter's setup hook (migrations live there now). */
async function initDb(db: DatabaseAdapter): Promise<void> {
  await db.lifecycle?.setup({ config: {}, logger: silentLogger });
}

describe("createBetterSqlite3Database", () => {
  it("throws without path or client", () => {
    expect(() => createBetterSqlite3Database({})).toThrow("provide `path`");
  });

  it("migrates and round-trips a project in memory", async () => {
    const db = createBetterSqlite3Database({ path: ":memory:" });
    await initDb(db);

    const now = new Date().toISOString();
    const project = (await db.insert(schema.projects, {
      id: "p1",
      name: "Demo",
      slug: "demo",
      createdAt: now,
      updatedAt: now,
    })) as Project;
    expect(project.name).toBe("Demo");

    const found = (await db.get(schema.projects, "p1")) as Project | null;
    expect(found?.slug).toBe("demo");

    await db.update(schema.projects, "p1", { name: "Renamed" });
    const renamed = (await db.get(schema.projects, "p1")) as Project | null;
    expect(renamed?.name).toBe("Renamed");

    await db.remove(schema.projects, "p1");
    expect(await db.get(schema.projects, "p1")).toBeNull();

    await db.lifecycle?.teardown();
  });

  it("commits transact writes and rolls back on throw", async () => {
    const db = createBetterSqlite3Database({ path: ":memory:" });
    await initDb(db);

    const now = new Date().toISOString();
    const result = await db.transact?.(async (tx) => {
      await tx.insert(schema.projects, {
        id: "p1",
        name: "Tx",
        slug: "tx",
        createdAt: now,
        updatedAt: now,
      });
      return "done";
    });
    expect(result).toBe("done");
    expect(await db.get(schema.projects, "p1")).not.toBeNull();

    await expect(
      db.transact?.(async (tx) => {
        await tx.insert(schema.projects, {
          id: "p2",
          name: "Doomed",
          slug: "doomed",
          createdAt: now,
          updatedAt: now,
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await db.get(schema.projects, "p2")).toBeNull();

    await db.lifecycle?.teardown();
  });

  it("accepts an injected client and leaves teardown to the caller", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storyshelf-better-sqlite3-"));
    try {
      const client = new Database(join(dir, "test.db"));
      const db = createBetterSqlite3Database({ client });
      await initDb(db);

      const now = new Date().toISOString();
      await db.insert(schema.projects, {
        id: "p1",
        name: "Demo",
        slug: "demo",
        createdAt: now,
        updatedAt: now,
      });
      expect(await db.get(schema.projects, "p1")).not.toBeNull();

      await db.lifecycle?.teardown();
      // Caller-owned: the client still works after adapter teardown.
      client.prepare("SELECT 1").get();
      client.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
