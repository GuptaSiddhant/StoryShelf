import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubRunner } from "../test-runner.ts";

const NOW = "2025-01-01T00:00:00.000Z";

describe("safe retention capability", () => {
  it("refuses build purge in testing mode when atomic lifecycle support is unavailable", async () => {
    const { db } = makeDatabase();
    const { storage, objects } = makeStorage();
    await db.insert(db.tables.projects, {
      id: "p",
      name: "P",
      slug: "p",
      gitDefaultBranch: "main",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db.insert(db.tables.builds, {
      id: "old",
      projectId: "p",
      gitSha: "a",
      gitBranch: "main",
      status: "approved",
      createdAt: NOW,
      updatedAt: NOW,
    });
    objects.set("p/builds/old/storybook/index.html", Buffer.from("original"));
    const app = createShelfApp({ database: db, storage, testing: { runner: stubRunner() } });
    const response = await app.request("/api/v1/admin/purge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("safe baseline retention");
    expect(await db.get(db.tables.builds, "old")).not.toBeNull();
    expect(objects.has("p/builds/old/storybook/index.html")).toBe(true);
  });
  it("keeps the existing purge path available in hosting-only mode", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({ database: db, storage });
    const response = await app.request("/api/v1/admin/purge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(200);
  });
});
