import { createClient } from "@libsql/client";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import type { Project } from "@storyshelf/core/schema";
import { schema } from "@storyshelf/db-sqlite/schema";
import { getTableColumns, sql } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTursoDatabase } from "./index.ts";

const silentLogger = createShelfLogger({ level: "silent" });

/** Run the adapter's setup hook (migrations live there now). */
async function initDb(db: DatabaseAdapter): Promise<void> {
  await db.lifecycle?.setup({ config: {}, logger: silentLogger });
}

function createTempTurso(): { dir: string; db: ReturnType<typeof createTursoDatabase> } {
  const dir = mkdtempSync(join(tmpdir(), "storyshelf-turso-"));
  const db = createTursoDatabase({ url: `file:${join(dir, "test.db")}` });
  return { dir, db };
}

async function cleanupTurso(
  dir: string,
  db: ReturnType<typeof createTursoDatabase>,
): Promise<void> {
  await db.lifecycle?.teardown();
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
    const { dir, db } = createTempTurso();
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

    await cleanupTurso(dir, db);
  });

  it("updates and removes a project", async () => {
    const { dir, db } = createTempTurso();
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

    await cleanupTurso(dir, db);
  });

  it("back-fills a stale volume with every current projects column", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storyshelf-turso-"));
    const url = `file:${join(dir, "test.db")}`;
    // Simulate the oldest deployed volume: only the pre-ADR-0017 columns exist.
    const seed = createClient({ url });
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

    const db = createTursoDatabase({ url });
    await initDb(db);

    const expected = Object.values(getTableColumns(schema.projects)).map((column) => column.name);
    const inspector = createClient({ url });
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
    expect(project.browser).toBe("chromium");

    const listed = await db.list(schema.projects);
    expect(listed).toHaveLength(1);

    await cleanupTurso(dir, db);
  });

  it("commits transact writes and rolls back on throw", async () => {
    const { dir, db } = createTempTurso();
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

    await cleanupTurso(dir, db);
  });

  it("creates auth tables on fresh and stale volumes", async () => {
    const expected = ["user", "session", "account", "verification"] as const;

    const { dir: freshDir, db: fresh } = createTempTurso();
    await initDb(fresh);
    const freshTables = await tableNames(fresh);
    for (const table of expected) {
      expect(freshTables.has(table), `fresh ${table}`).toBe(true);
    }
    await cleanupTurso(freshDir, fresh);

    const dir = mkdtempSync(join(tmpdir(), "storyshelf-turso-auth-"));
    try {
      const url = `file:${join(dir, "test.db")}`;
      const seed = createTursoDatabase({ url });
      await initDb(seed);
      await seed.lifecycle?.teardown();
      const raw = createClient({ url });
      await raw.executeMultiple("DROP TABLE session; DROP TABLE account;");
      raw.close();

      const db = createTursoDatabase({ url });
      await initDb(db);
      const tables = await tableNames(db);
      for (const table of expected) {
        expect(tables.has(table), `stale ${table}`).toBe(true);
      }
      await cleanupTurso(dir, db);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
