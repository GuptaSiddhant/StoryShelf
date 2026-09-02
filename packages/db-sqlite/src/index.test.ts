import { describe, expect, it } from "vitest";

import { projects } from "@storyshelf/core/schema";

import { createSqliteDatabase } from "./index.ts";

describe("createSqliteDatabase", () => {
  it("migrates and inserts a project", async () => {
    const db = createSqliteDatabase(":memory:");
    await db.migrate();

    const now = new Date().toISOString();
    const project = await db.insert(projects, { id: "p1", name: "Demo", slug: "demo", createdAt: now, updatedAt: now });
    expect(project.name).toBe("Demo");

    const found = await db.get(projects, "p1");
    expect(found?.slug).toBe("demo");

    const listed = await db.list(projects);
    expect(listed).toHaveLength(1);

    await db.close();
  });

  it("updates and removes a project", async () => {
    const db = createSqliteDatabase(":memory:");
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
  });
});
