import { createClient as createSqlite3Client } from "@libsql/client/sqlite3";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import type { Project } from "@storyshelf/core/schema";
import { getTableColumns, sql } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
});
