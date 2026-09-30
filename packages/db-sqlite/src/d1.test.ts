import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import type { Project } from "@storyshelf/core/schema";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createD1Database, type D1Database } from "./d1.ts";
import { schema } from "./schema/index.ts";

const silentLogger = createShelfLogger({ level: "silent" });

/** Run the adapter's setup hook (migrations live there now). */
async function initDb(db: DatabaseAdapter): Promise<void> {
  await db.lifecycle?.setup({ config: {}, logger: silentLogger });
}

/**
 * Minimal D1 binding over better-sqlite3. Implements exactly the surface
 * drizzle's D1 session uses (`prepare().bind().all()/run()/first()`,
 * `batch()`) plus `exec()` for the preset's own migrations.
 */
function createStubBinding(): D1Database {
  const sqlite = new Database(":memory:");
  const bound = (sql: string, params: unknown[]) => ({
    bind: (...more: unknown[]) => bound(sql, [...params, ...more]),
    all: async () => ({ results: sqlite.prepare(sql).all(...params) as unknown[] }),
    run: async () => {
      sqlite.prepare(sql).run(...params);
      return { success: true };
    },
    first: async () => (sqlite.prepare(sql).get(...params) as unknown) ?? null,
    raw: async () =>
      sqlite
        .prepare(sql)
        .raw()
        .all(...params) as unknown[],
  });
  return {
    prepare: (sql: string) => bound(sql, []),
    batch: async (statements) => await Promise.all(statements.map(async (s) => await s.run())),
    exec: async (sql: string) => {
      sqlite.exec(sql);
    },
  };
}

describe("createD1Database", () => {
  it("throws without a client binding", () => {
    expect(() => createD1Database({} as never)).toThrow("provide a D1 `client`");
  });

  it("migrates and round-trips a project", async () => {
    const db = createD1Database({ client: createStubBinding() });
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

    const listed = await db.list(schema.projects);
    expect(listed).toHaveLength(1);

    await db.update(schema.projects, "p1", { name: "Renamed" });
    const renamed = (await db.get(schema.projects, "p1")) as Project | null;
    expect(renamed?.name).toBe("Renamed");

    await db.remove(schema.projects, "p1");
    expect(await db.get(schema.projects, "p1")).toBeNull();
  });

  it("commits transact writes and rolls back on throw", async () => {
    const db = createD1Database({ client: createStubBinding() });
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
  });

  it("teardown is a no-op: the platform owns the binding", async () => {
    const client = createStubBinding();
    const db = createD1Database({ client });
    await initDb(db);
    await db.lifecycle?.teardown();
    // Binding still usable after adapter teardown.
    await client.exec("SELECT 1");
  });
});
