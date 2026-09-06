import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import { projects } from "@storyshelf/core/schema";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTursoDatabase } from "./index.ts";

const silentLogger = createShelfLogger({ level: "silent" });

/** Run the adapter's init hook (migrations live there now). */
async function initDb(db: DatabaseAdapter): Promise<void> {
  await db.lifecycle?.init?.({ config: {}, logger: silentLogger });
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
  await db.lifecycle?.close?.();
  rmSync(dir, { recursive: true, force: true });
}

describe("createTursoDatabase", () => {
  it("migrates and inserts a project", async () => {
    const { dir, db } = createTempTurso();
    await initDb(db);

    const now = new Date().toISOString();
    const project = await db.insert(projects, {
      id: "p1",
      name: "Demo",
      slug: "demo",
      createdAt: now,
      updatedAt: now,
    });
    expect(project.name).toBe("Demo");

    const found = await db.get(projects, "p1");
    expect(found?.slug).toBe("demo");

    const listed = await db.list(projects);
    expect(listed).toHaveLength(1);

    await cleanupTurso(dir, db);
  });

  it("updates and removes a project", async () => {
    const { dir, db } = createTempTurso();
    await initDb(db);

    await db.insert(projects, {
      id: "p1",
      name: "Demo",
      slug: "demo",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.update(projects, "p1", { name: "Renamed" });
    const renamed = await db.get(projects, "p1");
    expect(renamed?.name).toBe("Renamed");

    await db.remove(projects, "p1");
    const afterRemove = await db.get(projects, "p1");
    expect(afterRemove).toBeNull();

    await cleanupTurso(dir, db);
  });
});
