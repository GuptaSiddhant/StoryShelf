import { createClient } from "@libsql/client";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import type { Project } from "@storyshelf/core/schema";
import { schema } from "@storyshelf/db-sqlite/schema";
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

  it("adds late projects columns to a stale volume", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storyshelf-turso-"));
    const url = `file:${join(dir, "test.db")}`;
    // Simulate a volume created before the browser/viewports/automigrate
    // columns shipped: the existing projects table cannot gain them from DDL,
    // so the in-place ALTERs must.
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
        storybook_meta TEXT,
        execute_play INTEGER NOT NULL DEFAULT 0,
        play_timeout_ms INTEGER NOT NULL DEFAULT 10000,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    seed.close();

    const db = createTursoDatabase({ url });
    await initDb(db);

    const now = new Date().toISOString();
    const project = (await db.insert(schema.projects, {
      id: "p1",
      name: "Demo",
      slug: "demo",
      createdAt: now,
      updatedAt: now,
    })) as Project;
    expect(project.browser).toBe("chromium");
    expect(project.viewports).toBeNull();

    const listed = await db.list(schema.projects);
    expect(listed).toHaveLength(1);

    await cleanupTurso(dir, db);
  });
});
