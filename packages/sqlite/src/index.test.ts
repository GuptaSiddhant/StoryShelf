import { describe, expect, it } from "vitest";

import { projects } from "@storyshelf/core/schema";

import { createSqliteDatabase } from "./index.ts";

describe("createSqliteDatabase", () => {
  it("migrates and performs CRUD", async () => {
    const db = createSqliteDatabase(":memory:");
    await db.migrate();

    const now = new Date().toISOString();
    const project = await db.insert(projects, { id: "p1", name: "Demo", slug: "demo", createdAt: now, updatedAt: now });
    expect(project.name).toBe("Demo");

    const found = await db.get(projects, "p1");
    expect(found?.slug).toBe("demo");

    const listed = await db.list(projects);
    expect(listed).toHaveLength(1);

    await db.update(projects, "p1", { name: "Renamed" });
    expect((await db.get(projects, "p1"))?.name).toBe("Renamed");

    await db.remove(projects, "p1");
    expect(await db.get(projects, "p1")).toBeNull();

    await db.close();
  });
});
