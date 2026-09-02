import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { projects } from "@storyshelf/core/schema";

import { createTursoDatabase } from "./index.ts";

describe("createTursoDatabase", () => {
  it("migrates and inserts a project", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storyshelf-turso-"));
    const db = createTursoDatabase({ url: `file:${join(dir, "test.db")}` });
    await db.migrate();

    const now = new Date().toISOString();
    const project = await db.insert(projects, { id: "p1", name: "Demo", slug: "demo", createdAt: now, updatedAt: now });
    expect(project.name).toBe("Demo");

    const found = await db.get(projects, "p1");
    expect(found?.slug).toBe("demo");

    const listed = await db.list(projects);
    expect(listed).toHaveLength(1);

    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("updates and removes a project", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storyshelf-turso-"));
    const db = createTursoDatabase({ url: `file:${join(dir, "test.db")}` });
    await db.migrate();

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

    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
