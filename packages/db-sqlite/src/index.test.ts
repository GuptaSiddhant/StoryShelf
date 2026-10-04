import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import type { Project } from "@storyshelf/core/schema";
import { getTableColumns, sql } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createSqliteDatabase } from "./index.ts";
import { schema } from "./schema/index.ts";

const silentLogger = createShelfLogger({ level: "silent" });

/** Run the adapter's setup hook (migrations live there now). */
async function initDb(db: DatabaseAdapter): Promise<void> {
  await db.lifecycle?.setup({ config: {}, logger: silentLogger });
}

/** Run the adapter's teardown hook. */
async function closeDb(db: DatabaseAdapter): Promise<void> {
  await db.lifecycle?.teardown();
}

/** Table names present in a volume (raw SQL: array rows, name first). */
async function tableNames(db: DatabaseAdapter): Promise<Set<string>> {
  const rows = await db.all<unknown[]>(sql`SELECT name FROM sqlite_master WHERE type = 'table'`);
  return new Set(rows.map((row) => String(row[0])));
}

describe("createSqliteDatabase", () => {
  it("migrates and inserts a project", async () => {
    const db = createSqliteDatabase(":memory:");
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

    await closeDb(db);
  });

  it("updates and removes a project", async () => {
    const db = createSqliteDatabase(":memory:");
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

    await closeDb(db);
  });

  it("returns null for a missing id (get miss path)", async () => {
    const db = createSqliteDatabase(":memory:");
    await initDb(db);

    await expect(db.get(schema.projects, "missing")).resolves.toBeNull();

    await closeDb(db);
  });

  it("counts rows and runs raw queries (all path)", async () => {
    const db = createSqliteDatabase(":memory:");
    await initDb(db);

    const now = new Date().toISOString();
    await db.insert(schema.projects, {
      id: "p1",
      name: "A",
      slug: "a",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.projects, {
      id: "p2",
      name: "B",
      slug: "b",
      createdAt: now,
      updatedAt: now,
    });

    await expect(db.count(schema.projects)).resolves.toBe(2);
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

  it("back-fills a stale volume with every current projects column", async () => {
    const db = createSqliteDatabase(":memory:");
    // Simulate the oldest deployed volume: only the pre-ADR-0017 columns exist.
    // The fresh DDL run cannot add later columns, so the in-place reconciliation must.
    await db.all(sql`
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
    await initDb(db);

    const expected = Object.values(getTableColumns(schema.projects)).map((column) => column.name);
    const rows = await db.all<unknown[]>(sql`PRAGMA table_info(projects)`);
    const present = new Set(rows.map((row) => String(row[1])));
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

  it("cascades attempt history when a build is removed (purge parity)", async () => {
    const db = createSqliteDatabase(":memory:");
    await initDb(db);
    const now = new Date().toISOString();
    await db.insert(schema.projects, {
      id: "p1",
      name: "Demo",
      slug: "demo",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.builds, {
      id: "b1",
      projectId: "p1",
      gitSha: "sha",
      gitBranch: "main",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.captureAttempts, {
      id: "a1",
      projectId: "p1",
      buildId: "b1",
      attemptNo: 1,
      queuedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.captureLogs, {
      id: "l1",
      projectId: "p1",
      buildId: "b1",
      attemptId: "a1",
      seq: 1,
      message: "capture started",
      createdAt: now,
    });

    await db.remove(schema.builds, "b1");

    expect(await db.get(schema.captureAttempts, "a1")).toBeNull();
    expect(await db.get(schema.captureLogs, "l1")).toBeNull();

    await closeDb(db);
  });

  it("allows re-runs sharing project and git sha (ULID build ids)", async () => {
    const db = createSqliteDatabase(":memory:");
    await initDb(db);
    const now = new Date().toISOString();
    await db.insert(schema.projects, {
      id: "p1",
      name: "Demo",
      slug: "demo",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.builds, {
      id: "b1",
      projectId: "p1",
      gitSha: "sha",
      gitBranch: "feature/smoke",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.builds, {
      id: "b2",
      projectId: "p1",
      gitSha: "sha",
      gitBranch: "feature/smoke",
      createdAt: now,
      updatedAt: now,
    });

    expect(await db.get(schema.builds, "b1")).not.toBeNull();
    expect(await db.get(schema.builds, "b2")).not.toBeNull();

    const indexSql = await db.all<[string]>(
      sql`SELECT sql FROM sqlite_master WHERE name = 'builds_project_gitsha_idx'`,
    );
    const definition = indexSql[0]?.[0] ?? "";
    expect(definition).toContain("CREATE INDEX");
    expect(definition).not.toContain("UNIQUE");

    await closeDb(db);
  });

  it("commits transact writes and returns the callback value", async () => {
    const db = createSqliteDatabase(":memory:");
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

    await closeDb(db);
  });

  it("rolls back transact writes when the callback throws", async () => {
    const db = createSqliteDatabase(":memory:");
    await initDb(db);

    const now = new Date().toISOString();
    await expect(
      db.transact?.(async (tx) => {
        await tx.insert(schema.projects, {
          id: "p1",
          name: "Doomed",
          slug: "doomed",
          createdAt: now,
          updatedAt: now,
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await db.get(schema.projects, "p1")).toBeNull();

    await closeDb(db);
  });

  it("creates auth tables on fresh and stale volumes", async () => {
    const expected = ["user", "session", "account", "verification"] as const;

    const fresh = createSqliteDatabase(":memory:");
    await initDb(fresh);
    const freshTables = await tableNames(fresh);
    for (const table of expected) {
      expect(freshTables.has(table), `fresh ${table}`).toBe(true);
    }
    await closeDb(fresh);

    const dir = mkdtempSync(join(tmpdir(), "storyshelf-sqlite-auth-"));
    try {
      const seed = createSqliteDatabase(join(dir, "stale.db"));
      await initDb(seed);
      await seed.lifecycle?.teardown();
      const raw = new DatabaseSync(join(dir, "stale.db"));
      raw.exec("DROP TABLE session; DROP TABLE account;");
      raw.close();

      const db = createSqliteDatabase(join(dir, "stale.db"));
      await initDb(db);
      const tables = await tableNames(db);
      for (const table of expected) {
        expect(tables.has(table), `stale ${table}`).toBe(true);
      }
      await closeDb(db);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
