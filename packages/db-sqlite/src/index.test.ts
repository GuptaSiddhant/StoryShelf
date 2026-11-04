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

  it("back-fills baseline tracking columns on a stale snapshots table", async () => {
    const db = createSqliteDatabase(":memory:");
    await db.all(sql`
      CREATE TABLE snapshots (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        build_id TEXT NOT NULL,
        story_id TEXT NOT NULL,
        story_name TEXT NOT NULL,
        story_title TEXT NOT NULL,
        viewport_name TEXT NOT NULL DEFAULT 'desktop',
        screenshot_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await initDb(db);

    const rows = await db.all<unknown[]>(sql`PRAGMA table_info(snapshots)`);
    const present = new Set(rows.map((row) => String(row[1])));
    expect(present.has("baseline_id")).toBe(true);
    expect(present.has("baseline_version")).toBe(true);
    expect(present.has("source_build_id")).toBe(true);
    expect(present.has("comparison_image_path")).toBe(true);
    expect(present.has("comparison_metadata")).toBe(true);

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
    expect(project.runA11y).toBe(true);
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

  it("upgrades a pre-browser volume in place: rows fall back to chromium, indexes are swapped", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storyshelf-sqlite-browser-"));
    const path = join(dir, "legacy.db");
    try {
      const seed = createSqliteDatabase(path);
      await initDb(seed);
      await seed.lifecycle?.teardown();
      const raw = new DatabaseSync(path);
      raw.exec(`
        DROP INDEX snapshots_build_story_mode_browser_idx;
        DROP INDEX baselines_project_story_mode_browser_branch_idx;
        ALTER TABLE snapshots DROP COLUMN browser;
        ALTER TABLE snapshots DROP COLUMN mode;
        ALTER TABLE baselines DROP COLUMN browser;
        ALTER TABLE baselines DROP COLUMN mode;
        ALTER TABLE projects DROP COLUMN browsers;
        ALTER TABLE projects DROP COLUMN modes_allowlist;
        CREATE UNIQUE INDEX snapshots_build_story_viewport_idx ON snapshots (build_id, story_id, viewport_name);
        CREATE UNIQUE INDEX baselines_project_story_viewport_branch_idx ON baselines (project_id, story_id, viewport_name, branch);
        INSERT INTO projects (id, name, slug, browser, created_at, updated_at) VALUES ('p', 'P', 'p', 'firefox', 't', 't');
        INSERT INTO baselines (id, project_id, story_id, viewport_name, branch, screenshot_path, created_at, updated_at) VALUES ('b1', 'p', 's', 'desktop', 'main', 'x', 't', 't');
      `);
      raw.close();

      const db = createSqliteDatabase(path);
      await initDb(db);
      await initDb(db); // idempotent

      const baselines = (await db.list(schema.baselines)) as { browser: string }[];
      expect(baselines.map((row) => row.browser)).toEqual(["chromium"]);
      const rows = await db.all<unknown[]>(
        sql`SELECT name FROM sqlite_master WHERE type = 'index'`,
      );
      const names = rows.map((row) => String(row[0]));
      expect(names).toContain("snapshots_build_story_mode_browser_idx");
      expect(names).toContain("baselines_project_story_mode_browser_branch_idx");
      expect(names).not.toContain("snapshots_build_story_viewport_idx");

      const now = "2026-01-01T00:00:00.000Z";
      const second = (browser: string) =>
        db.insert(schema.baselines, {
          id: `b-${browser}`,
          projectId: "p",
          storyId: "s",
          viewportName: "desktop",
          branch: "main",
          browser,
          screenshotPath: "y",
          createdAt: now,
          updatedAt: now,
        });
      await expect(second("firefox")).resolves.toBeDefined();
      await expect(second("chromium")).rejects.toThrow();
      await closeDb(db);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adds the lifecycle state to an existing build without marking it deleting", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storyshelf-sqlite-lifecycle-"));
    const path = join(dir, "legacy.db");
    try {
      const seed = createSqliteDatabase(path);
      await initDb(seed);
      await closeDb(seed);
      const raw = new DatabaseSync(path);
      raw.exec(`
        DROP TABLE build_references;
        DROP TABLE build_reference_generations;
        ALTER TABLE builds DROP COLUMN retention_state;
        INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', 't', 't');
        INSERT INTO builds (id, project_id, git_sha, git_branch, created_at, updated_at) VALUES ('b', 'p', 'sha', 'main', 't', 't');
      `);
      raw.close();
      const db = createSqliteDatabase(path);
      await initDb(db);
      expect((await db.get(schema.builds, "b"))?.["retentionState"]).toBe("available");
      expect((await tableNames(db)).has("build_references")).toBe(true);
      expect((await tableNames(db)).has("build_reference_generations")).toBe(true);
      await closeDb(db);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adds the single-flight key and its unique index to a volume created before them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storyshelf-sqlite-jobkey-"));
    const path = join(dir, "legacy.db");
    try {
      const seed = createSqliteDatabase(path);
      await initDb(seed);
      await closeDb(seed);
      const raw = new DatabaseSync(path);
      raw.exec(`
        DROP INDEX capture_jobs_active_key_idx;
        ALTER TABLE capture_jobs DROP COLUMN active_key;
        ALTER TABLE capture_jobs DROP COLUMN rerun_requested_at;
        INSERT INTO capture_jobs (id, entry, job_id, kind, status, created_at, updated_at)
          VALUES ('j1', 'job', 'j1', 'notify', 'queued', 't', 't'),
                 ('j2', 'job', 'j2', 'notify', 'queued', 't', 't');
      `);
      raw.close();
      const db = createSqliteDatabase(path);
      await initDb(db);
      await closeDb(db);
      const check = new DatabaseSync(path);
      const rows = check
        .prepare("SELECT id, active_key, rerun_requested_at FROM capture_jobs ORDER BY id")
        .all();
      expect(
        rows.map((row) => ({
          id: row["id"],
          active_key: row["active_key"],
          rerun_requested_at: row["rerun_requested_at"],
        })),
      ).toEqual([
        { id: "j1", active_key: null, rerun_requested_at: null },
        { id: "j2", active_key: null, rerun_requested_at: null },
      ]);
      // Rows without a key coexist; two rows with the same key do not.
      check.exec("UPDATE capture_jobs SET active_key = 'notify:c:b' WHERE id = 'j1'");
      expect(() =>
        check.exec("UPDATE capture_jobs SET active_key = 'notify:c:b' WHERE id = 'j2'"),
      ).toThrow(/UNIQUE/u);
      check.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("gives a build in flight the capture job that was running when the column was added", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storyshelf-sqlite-capture-job-"));
    const path = join(dir, "legacy.db");
    try {
      const seed = createSqliteDatabase(path);
      await initDb(seed);
      await closeDb(seed);
      const raw = new DatabaseSync(path);
      raw.exec(`
        INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', 't', 't');
        INSERT INTO builds (id, project_id, git_sha, git_branch, status, created_at, updated_at) VALUES
          ('run', 'p', 'a', 'main', 'capturing', 't', 't'),
          ('old', 'p', 'b', 'main', 'pending', 't', 't'),
          ('none', 'p', 'c', 'main', 'pending', 't', 't'),
          ('tie', 'p', 'e', 'main', 'pending', 't', 't'),
          ('many', 'p', 'f', 'main', 'pending', 't', 't'),
          ('done', 'p', 'd', 'main', 'passed', 't', 't');
        INSERT INTO capture_jobs (id, entry, job_id, kind, build_id, shard_id, status, created_at, updated_at) VALUES
          ('j1', 'job', 'j1', 'capture', 'run', NULL, 'running', '2026-01-01', 't'),
          ('j1:1', 'attempt', 'j1', 'capture', 'run', NULL, 'running', '2026-01-02', 't'),
          ('j2', 'job', 'j2', 'capture', 'old', NULL, 'failed', '2026-01-01', 't'),
          ('j3', 'job', 'j3', 'capture', 'old', NULL, 'queued', '2026-01-02', 't'),
          ('s1', 'job', 's1', 'capture', 'run', 'shard', 'queued', '2026-01-03', 't'),
          ('j4', 'job', 'j4', 'capture', 'done', NULL, 'queued', '2026-01-01', 't'),
          ('t1', 'job', 't1', 'capture', 'tie', NULL, 'queued', '2026-01-05', 't'),
          ('t2', 'job', 't2', 'capture', 'tie', NULL, 'queued', '2026-01-05', 't'),
          ('m1', 'job', 'm1', 'capture', 'many', NULL, 'queued', '2026-01-01', 't'),
          ('m2', 'job', 'm2', 'capture', 'many', NULL, 'queued', '2026-01-09', 't');
        ALTER TABLE builds DROP COLUMN capture_job_id;
      `);
      raw.close();

      const db = createSqliteDatabase(path);
      await initDb(db);

      const rows = (await db.list(schema.builds)) as { id: string; captureJobId: string | null }[];
      const owners = Object.fromEntries(rows.map((row) => [row.id, row.captureJobId]));
      expect(owners).toEqual({
        run: "j1",
        old: "j3",
        none: null,
        tie: null,
        many: null,
        done: null,
      });
      await closeDb(db);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adds builds.capture_generation at 0 to a database created without it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storyshelf-sqlite-generation-"));
    const path = join(dir, "legacy.db");
    try {
      const seed = createSqliteDatabase(path);
      await initDb(seed);
      await closeDb(seed);
      const raw = new DatabaseSync(path);
      raw.exec(`
        INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', 't', 't');
        INSERT INTO builds (id, project_id, git_sha, git_branch, status, created_at, updated_at)
          VALUES ('b', 'p', 'a', 'main', 'pending', 't', 't');
        ALTER TABLE builds DROP COLUMN capture_generation;
      `);
      raw.close();

      const db = createSqliteDatabase(path);
      await initDb(db);

      const rows = (await db.list(schema.builds)) as { id: string; captureGeneration: number }[];
      expect(rows.map((row) => row.captureGeneration)).toEqual([0]);
      await closeDb(db);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves a cancel-requested job out of the backfill, and stops setup when the backfill fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storyshelf-sqlite-capture-job-fail-"));
    const path = join(dir, "legacy.db");
    try {
      const seed = createSqliteDatabase(path);
      await initDb(seed);
      await closeDb(seed);
      const raw = new DatabaseSync(path);
      raw.exec(`
        INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', 't', 't');
        INSERT INTO builds (id, project_id, git_sha, git_branch, status, created_at, updated_at)
          VALUES ('b', 'p', 'a', 'main', 'pending', 't', 't');
        INSERT INTO capture_jobs (id, entry, job_id, kind, build_id, status, cancel_requested_at, created_at, updated_at)
          VALUES ('j', 'job', 'j', 'capture', 'b', 'running', 't', 't', 't');
      `);
      raw.close();
      const db = createSqliteDatabase(path);
      await initDb(db);
      expect(
        ((await db.get(schema.builds, "b"))?.["captureJobId"] ?? null) as string | null,
      ).toBeNull();
      await closeDb(db);

      const broken = new DatabaseSync(path);
      broken.exec(`
        UPDATE capture_jobs SET cancel_requested_at = NULL;
        CREATE TRIGGER no_build_update BEFORE UPDATE ON builds BEGIN SELECT RAISE(ABORT, 'locked'); END;
      `);
      broken.close();
      const failing = createSqliteDatabase(path);
      await expect(initDb(failing)).rejects.toThrow(/locked/u);
      await closeDb(failing);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adds comments.mentions to a volume created before it, keeping existing comments", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storyshelf-sqlite-mentions-"));
    const path = join(dir, "legacy.db");
    try {
      const seed = createSqliteDatabase(path);
      await initDb(seed);
      await closeDb(seed);
      const raw = new DatabaseSync(path);
      raw.exec(`
        ALTER TABLE comments DROP COLUMN mentions;
        INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', 't', 't');
        INSERT INTO builds (id, project_id, git_sha, git_branch, created_at, updated_at) VALUES ('b', 'p', 'sha', 'main', 't', 't');
        INSERT INTO comments (id, project_id, build_id, body, created_at, updated_at) VALUES ('c', 'p', 'b', 'older comment', 't', 't');
      `);
      raw.close();
      const db = createSqliteDatabase(path);
      await initDb(db);
      const row = await db.get(schema.comments, "c");
      expect(row?.["body"]).toBe("older comment");
      expect(row?.["mentions"]).toBeNull();
      await closeDb(db);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adds subscriptions.review_requests to an older volume with review requests on", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storyshelf-sqlite-review-requests-"));
    const path = join(dir, "legacy.db");
    try {
      const seed = createSqliteDatabase(path);
      await initDb(seed);
      await closeDb(seed);
      const raw = new DatabaseSync(path);
      raw.exec(`
        ALTER TABLE notification_subscriptions DROP COLUMN review_requests;
        INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', 't', 't');
        INSERT INTO users (id, email, name, created_at) VALUES ('u', 'u@example.com', 'U', 't');
        INSERT INTO notification_subscriptions (id, project_id, user_id, enabled, created_at) VALUES ('s', 'p', 'u', 0, 't');
      `);
      raw.close();
      const db = createSqliteDatabase(path);
      await initDb(db);
      const row = await db.get(schema.notificationSubscriptions, "s");
      expect(row?.["enabled"]).toBe(false);
      expect(row?.["reviewRequests"]).toBe(true);
      await closeDb(db);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adds the fingerprint columns to a volume created before them, keeping existing rows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storyshelf-sqlite-fingerprint-"));
    const path = join(dir, "legacy.db");
    try {
      const seed = createSqliteDatabase(path);
      await initDb(seed);
      await seed.lifecycle?.teardown();
      const raw = new DatabaseSync(path);
      raw.exec(`
        ALTER TABLE snapshots DROP COLUMN env_change;
        ALTER TABLE baselines DROP COLUMN fingerprint;
        ALTER TABLE baselines DROP COLUMN source_build_id;
        INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', 't', 't');
        INSERT INTO baselines (id, project_id, story_id, viewport_name, branch, screenshot_path, infra_hash, created_at, updated_at) VALUES ('b1', 'p', 's', 'desktop', 'main', 'x', 'old-hash', 't', 't');
      `);
      raw.close();

      const db = createSqliteDatabase(path);
      await initDb(db);

      const [baseline] = (await db.list(schema.baselines)) as {
        infraHash: string | null;
        fingerprint: string | null;
      }[];
      expect(baseline).toMatchObject({
        infraHash: "old-hash",
        fingerprint: null,
        sourceBuildId: null,
      });
      const columns = (
        await db.all<unknown[]>(sql`SELECT name FROM pragma_table_info('snapshots')`)
      ).map((row) => String(row[0]));
      expect(columns).toContain("env_change");
      await closeDb(db);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
