import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import type { Project } from "@storyshelf/core/schema";
import { describe, expect, it } from "vitest";
import { schema } from "./schema/index.ts";

// Bun-only: `bun:sqlite` cannot load under Node, so the implementation module
// is dynamically imported inside the gated suite (never at collection time).
// Runs under Bun, e.g. `bunx --bun vitest run src/bun-sqlite.test.ts`.
const HAS_BUN = (process.versions as Record<string, string | undefined>)["bun"] !== undefined;

const silentLogger = createShelfLogger({ level: "silent" });

/** Run the adapter's setup hook (migrations live there now). */
async function initDb(db: DatabaseAdapter): Promise<void> {
  await db.lifecycle?.setup({ config: {}, logger: silentLogger });
}

describe.skipIf(!HAS_BUN)("createBunSqliteDatabase (bun runtime)", () => {
  it("throws without path or client", async () => {
    const { createBunSqliteDatabase } = await import("./bun-sqlite.ts");
    expect(() => createBunSqliteDatabase({})).toThrow("provide `path`");
  });

  it("migrates and round-trips a project in memory", async () => {
    const { createBunSqliteDatabase } = await import("./bun-sqlite.ts");
    const db = createBunSqliteDatabase({ path: ":memory:" });
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

    await db.lifecycle?.teardown();
  });

  it("commits transact writes and rolls back on throw", async () => {
    const { createBunSqliteDatabase } = await import("./bun-sqlite.ts");
    const db = createBunSqliteDatabase({ path: ":memory:" });
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
});
