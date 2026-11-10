import { createClient as createSqlite3Client } from "@libsql/client/sqlite3";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import type { Project } from "@storyshelf/core/schema";
import { getTableColumns, sql } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import { schema } from "./schema/index.ts";
import { createTursoDatabase } from "./turso.ts";

const silentLogger = createShelfLogger({ level: "silent" });

/** Run the adapter's setup hook (migrations live there now). */
async function initDb(db: DatabaseAdapter): Promise<void> {
  await db.lifecycle?.setup({ config: {}, logger: silentLogger });
}

type TestClient = ReturnType<typeof createSqlite3Client>;

/**
 * Use the `sqlite3` transport for local-file tests: the default Node binding
 * (`@libsql/client`) exits with SIGSEGV during process teardown on Node 24,
 * which makes Vitest report an unhandled worker crash even when every
 * assertion passed. The adapter contract is the same.
 */
function createTempTurso(): {
  dir: string;
  db: ReturnType<typeof createTursoDatabase>;
  client: TestClient;
} {
  const dir = mkdtempSync(join(tmpdir(), "storyshelf-turso-"));
  const client = createSqlite3Client({ url: `file:${join(dir, "test.db")}` });
  const db = createTursoDatabase({ client });
  return { dir, db, client };
}

async function cleanupTurso(
  dir: string,
  db: ReturnType<typeof createTursoDatabase>,
  client: TestClient,
): Promise<void> {
  await db.lifecycle?.teardown();
  client.close();
  rmSync(dir, { recursive: true, force: true });
}

/** Table names present in a volume (raw SQL returns libsql row objects). */
async function tableNames(db: DatabaseAdapter): Promise<Set<string>> {
  const rows = await db.all<{ name: unknown }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table'`,
  );
  return new Set(rows.map((row) => String(row.name)));
}

/** A Turso database whose `comments` table still requires a user, with one row in it. */
async function legacyCommentsVolume() {
  const { dir, db, client } = createTempTurso();
  await initDb(db);
  await client.execute("PRAGMA foreign_keys = OFF");
  await client.executeMultiple(`INSERT INTO users (id, name, email, created_at) VALUES ('u', 'U', 'u@x', '2026-01-01T00:00:00.000Z');
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
  return { dir, db, client };
}

describe("createTursoDatabase", () => {
  it("migrates and inserts a project", async () => {
    const { dir, db, client } = createTempTurso();
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

    await cleanupTurso(dir, db, client);
  });

  it("updates and removes a project", async () => {
    const { dir, db, client } = createTempTurso();
    await initDb(db);

    await db.insert(schema.projects, {
      id: "p1",
      name: "Demo",
      slug: "demo",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.update(schema.projects, "p1", { name: "Renamed" });
    const renamed = (await db.get(schema.projects, "p1")) as Project | null;
    expect(renamed?.name).toBe("Renamed");

    await db.remove(schema.projects, "p1");
    const afterRemove = await db.get(schema.projects, "p1");
    expect(afterRemove).toBeNull();

    await cleanupTurso(dir, db, client);
  });

  it("back-fills a stale volume with every current projects column", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storyshelf-turso-"));
    const url = `file:${join(dir, "test.db")}`;
    // Simulate the oldest deployed volume: only the pre-ADR-0017 columns exist.
    const seed = createSqlite3Client({ url });
    await seed.execute(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        git_repository TEXT,
        git_default_branch TEXT NOT NULL DEFAULT 'main',
        pixel_threshold REAL NOT NULL DEFAULT 0.1,
        max_diff_ratio REAL NOT NULL DEFAULT 0.01,
        public_branch_regex TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    seed.close();

    const client = createSqlite3Client({ url });
    const db = createTursoDatabase({ client });
    await initDb(db);

    const expected = Object.values(getTableColumns(schema.projects)).map((column) => column.name);
    const inspector = createSqlite3Client({ url });
    const info = await inspector.execute("PRAGMA table_info(projects)");
    inspector.close();
    const present = new Set(
      info.rows.map((row) => String((row as unknown as { name: unknown }).name)),
    );
    for (const column of expected) {
      expect(present.has(column)).toBe(true);
    }

    const now = new Date().toISOString();
    const project = (await db.insert(schema.projects, {
      id: "p1",
      name: "Demo",
      slug: "demo",
      createdAt: now,
      updatedAt: now,
    })) as Project;
    expect(project.executePlay).toBe(false);
    expect(project.playTimeoutMs).toBe(10_000);
    expect(project.runA11y).toBe(true);
    expect(project.browser).toBe("chromium");

    const listed = await db.list(schema.projects);
    expect(listed).toHaveLength(1);

    await cleanupTurso(dir, db, client);
  });

  it("commits transact writes and rolls back on throw", async () => {
    const { dir, db, client } = createTempTurso();
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

    await cleanupTurso(dir, db, client);
  });

  it("rebuilds a comments table that still requires a user in one batch, keeping its rows", async () => {
    const { dir, db, client } = await legacyCommentsVolume();

    await initDb(createTursoDatabase({ client }));

    const columns = (await client.execute("PRAGMA table_info(comments)")).rows as unknown as {
      name: string;
      notnull: number;
    }[];
    expect(columns.find((column) => column.name === "user_id")?.notnull).toBe(0);
    expect(columns.map((column) => column.name)).toContain("story_id");
    const rows = (await client.execute("SELECT id FROM comments")).rows as unknown as {
      id: string;
    }[];
    expect(rows.map((row) => row.id)).toEqual(["c1"]);
    await cleanupTurso(dir, db, client);
  });

  it("keeps the old comments table and its row when the rebuild batch fails, and rebuilds on a retry", async () => {
    const { dir, db, client } = await legacyCommentsVolume();
    // A failed write batch is rolled back whole: nothing of the rebuild lands.
    const broken = new Proxy(client, {
      get(target, property) {
        if (property === "batch") {
          return async () => {
            throw new Error("SQLite error: boom");
          };
        }
        const value: unknown = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await expect(initDb(createTursoDatabase({ client: broken }))).rejects.toThrow("boom");

    const userNotNull = async (): Promise<number | undefined> =>
      (
        (await client.execute("PRAGMA table_info(comments)")).rows as unknown as {
          name: string;
          notnull: number;
        }[]
      ).find((column) => column.name === "user_id")?.notnull;
    expect(await userNotNull()).toBe(1);
    const rows = (await client.execute("SELECT id FROM comments")).rows as unknown as {
      id: string;
    }[];
    expect(rows.map((row) => row.id)).toEqual(["c1"]);

    await initDb(createTursoDatabase({ client }));
    expect(await userNotNull()).toBe(0);
    await cleanupTurso(dir, db, client);
  });

  it("fails the boot on a statement that errors, and skips only the already-done ones", async () => {
    const { dir, db, client } = createTempTurso();
    await initDb(db);
    const failing = (error: Error): TestClient =>
      new Proxy(client, {
        get(target, property) {
          if (property === "execute") {
            return async (statement: string) => {
              if (statement.startsWith("ALTER TABLE webhooks DROP COLUMN")) throw error;
              return await target.execute(statement);
            };
          }
          const value: unknown = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });

    await expect(
      initDb(createTursoDatabase({ client: failing(new Error("SQLite error: boom")) })),
    ).rejects.toThrow("boom");
    await expect(
      initDb(createTursoDatabase({ client: failing(new Error('no such column: "secret"')) })),
    ).resolves.toBeUndefined();
    await cleanupTurso(dir, db, client);
  });

  it("commits many overlapping transactions, one at a time", async () => {
    const { dir, db, client } = createTempTurso();
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
    await cleanupTurso(dir, db, client);
  });

  it("boots without the design-link index when rows repeat its key, and says so once", async () => {
    const { dir, db, client } = createTempTurso();
    await initDb(db);
    await client.executeMultiple(`DROP INDEX design_links_project_import_path_idx;
      INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO design_links (id, project_id, import_path, url, created_at, updated_at)
        VALUES ('d1', 'p', './A.tsx', 'u1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'), ('d2', 'p', './A.tsx', 'u2', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');`);
    const error = vi.fn();

    await createTursoDatabase({ client }).lifecycle?.setup({
      config: {},
      logger: { error } as unknown as typeof silentLogger,
    });

    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]?.[0]).toEqual({
      table: "design_links",
      index: "design_links_project_import_path_idx",
      duplicateGroups: 1,
    });
    await cleanupTurso(dir, db, client);
  });

  it("creates auth tables on fresh and stale volumes", async () => {
    const expected = ["user", "session", "account", "verification"] as const;

    const { dir: freshDir, db: fresh, client: freshClient } = createTempTurso();
    await initDb(fresh);
    const freshTables = await tableNames(fresh);
    for (const table of expected) {
      expect(freshTables.has(table), `fresh ${table}`).toBe(true);
    }
    await cleanupTurso(freshDir, fresh, freshClient);

    const dir = mkdtempSync(join(tmpdir(), "storyshelf-turso-auth-"));
    try {
      const url = `file:${join(dir, "test.db")}`;
      const seedClient = createSqlite3Client({ url });
      const seed = createTursoDatabase({ client: seedClient });
      await initDb(seed);
      await seed.lifecycle?.teardown();
      seedClient.close();
      const raw = createSqlite3Client({ url });
      await raw.executeMultiple("DROP TABLE session; DROP TABLE account;");
      raw.close();

      const client = createSqlite3Client({ url });
      const db = createTursoDatabase({ client });
      await initDb(db);
      const tables = await tableNames(db);
      for (const table of expected) {
        expect(tables.has(table), `stale ${table}`).toBe(true);
      }
      await cleanupTurso(dir, db, client);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws on missing or blank url without a client", () => {
    expect(() => createTursoDatabase({})).toThrow("provide `url`");
    expect(() => createTursoDatabase({ url: "   " })).toThrow("provide `url`");
    expect(() => createTursoDatabase({ authToken: "tok" })).toThrow("provide `url`");
  });

  it("throws on unsupported url schemes", () => {
    expect(() => createTursoDatabase({ url: "db.turso.io" })).toThrow("unsupported url");
    expect(() => createTursoDatabase({ url: "postgres://x" })).toThrow("unsupported url");
  });

  it("accepts an injected client and leaves teardown to the caller", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storyshelf-turso-"));
    try {
      const url = `file:${join(dir, "test.db")}`;
      const client = createSqlite3Client({ url });
      const db = createTursoDatabase({ client });
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
      await client.execute("SELECT 1");
      client.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses an upgrade over a build_reviews table made outside StoryShelf, naming its column", async () => {
    const { dir, db, client } = createTempTurso();
    try {
      await client.executeMultiple(
        "DROP TABLE IF EXISTS build_reviews; CREATE TABLE build_reviews (id TEXT PRIMARY KEY, verdict TEXT)",
      );
      await expect(initDb(db)).rejects.toThrow("table build_reviews has no column build_id");
    } finally {
      await cleanupTurso(dir, db, client);
    }
  });
});
