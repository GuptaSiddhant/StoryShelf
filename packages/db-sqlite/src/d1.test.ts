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

  it("declares that it cannot back testing (no long-running process)", () => {
    const db = createD1Database({ client: createStubBinding() });
    expect(db.metadata.supportsTesting).toBe(false);
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

  it("rebuilds a comments table that still requires a user in one batch, keeping its rows", async () => {
    const client = createStubBinding();
    await initDb(createD1Database({ client }));
    await client.exec("PRAGMA foreign_keys = OFF");
    await client.exec(`INSERT INTO users (id, name, email, created_at) VALUES ('u', 'U', 'u@x', '2026-01-01T00:00:00.000Z');
      INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO builds (id, project_id, git_sha, git_branch, status, created_at, updated_at) VALUES ('b', 'p', 's', 'main', 'pending', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      DROP TABLE comments;
      CREATE TABLE comments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        build_id TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
        snapshot_id TEXT REFERENCES snapshots(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        parent_id TEXT,
        resolved INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO comments (id, project_id, build_id, user_id, body, created_at, updated_at)
        VALUES ('c1', 'p', 'b', 'u', 'kept', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');`);

    await initDb(createD1Database({ client }));

    const columns = (await client.prepare("PRAGMA table_info(comments)").bind().all()) as {
      results: { name: string; notnull: number }[];
    };
    expect(columns.results.find((column) => column.name === "user_id")?.notnull).toBe(0);
    expect(columns.results.map((column) => column.name)).toContain("story_id");
    const rows = (await client.prepare("SELECT id FROM comments").bind().all()) as {
      results: { id: string }[];
    };
    expect(rows.results.map((row) => row.id)).toEqual(["c1"]);
  });

  it("fails the boot on a statement that errors, and skips only the already-done ones", async () => {
    const client = createStubBinding();
    await initDb(createD1Database({ client }));
    const failing = (error: Error): D1Database => ({
      ...client,
      exec: async (query: string) => {
        if (query.startsWith("ALTER TABLE webhooks DROP COLUMN")) throw error;
        return await client.exec(query);
      },
    });

    await expect(
      initDb(createD1Database({ client: failing(new Error("D1_ERROR: boom")) })),
    ).rejects.toThrow("boom");
    await expect(
      initDb(createD1Database({ client: failing(new Error('no such column: "secret"')) })),
    ).resolves.toBeUndefined();
  });

  it("commits many overlapping transactions, one at a time", async () => {
    const db = createD1Database({ client: createStubBinding() });
    await initDb(db);
    const now = new Date().toISOString();

    const results = await Promise.allSettled(
      Array.from({ length: 15 }, async (_unused, index) =>
        db.transact?.(async (tx) => {
          await tx.insert(schema.projects, {
            id: `p${String(index)}`,
            name: "Tx",
            slug: `tx-${String(index)}`,
            createdAt: now,
            updatedAt: now,
          });
        }),
      ),
    );

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(await db.count(schema.projects)).toBe(15);
  });

  it("teardown is a no-op: the platform owns the binding", async () => {
    const client = createStubBinding();
    const db = createD1Database({ client });
    await initDb(db);
    await db.lifecycle?.teardown();
    // Binding still usable after adapter teardown.
    await client.exec("SELECT 1");
  });

  it("refuses an upgrade over a build_reviews table made outside StoryShelf, naming its column", async () => {
    const binding = createStubBinding();
    await binding.exec(
      "DROP TABLE IF EXISTS build_reviews; CREATE TABLE build_reviews (id TEXT PRIMARY KEY, verdict TEXT)",
    );
    await expect(initDb(createD1Database({ client: binding }))).rejects.toThrow(
      "table build_reviews has no column build_id",
    );
  });

  it("lets a binding that refuses PRAGMA through, as the column inspection does", async () => {
    const binding = createStubBinding();
    const prepare = binding.prepare.bind(binding);
    binding.prepare = (sql: string) => {
      if (sql.startsWith("PRAGMA table_info")) {
        throw new Error("PRAGMA is not served");
      }
      return prepare(sql);
    };
    await expect(initDb(createD1Database({ client: binding }))).resolves.toBeUndefined();
  });
});
