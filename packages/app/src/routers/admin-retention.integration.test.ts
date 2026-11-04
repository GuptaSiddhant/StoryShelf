import { Retention } from "@storyshelf/core/retention";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";

const NOW = "2025-01-01T00:00:00.000Z";

afterEach(() => {
  vi.restoreAllMocks();
});

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
  it("tells the administrator why when the database paused retention at boot", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    Object.assign(db, {
      retentionPause: { baselineId: "B1", buildId: "S1", problem: "tombstoned" },
    });
    const app = createShelfApp({ database: db, storage, testing: { runner: stubRunner() } });
    const response = await app.request("/api/v1/admin/purge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toContain("retention is paused");
    expect(text).toContain("B1");
    expect(text).toContain("S1");
  });
  it("refuses to purge a hosting-only database whose retention is paused, with or without testing", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    Object.assign(db, {
      retentionPause: { baselineId: "B1", buildId: "S1", problem: "tombstoned" },
    });
    const app = createShelfApp({ database: db, storage });
    const response = await app.request("/api/v1/admin/purge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("retention is paused");
  });
  it("reports zero protected and resumed builds when the capability is on and there is no project", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    Object.assign(db, { buildReferenceLifecycle: {} });
    const app = createShelfApp({ database: db, storage, testing: { runner: stubRunner() } });
    const response = await app.request("/api/v1/admin/purge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ removedBuilds: 0, protected: 0, resumed: 0 });
  });
  it.each([
    { branchTtlDays: null, removes: false },
    { branchTtlDays: undefined, removes: true },
  ])(
    "manual purge removes stale branches only when branch GC is on ($branchTtlDays)",
    async ({ branchTtlDays, removes }) => {
      const { db } = makeDatabase();
      const { storage } = makeStorage();
      await db.insert(db.tables.projects, {
        id: "p",
        name: "P",
        slug: "p",
        createdAt: NOW,
        updatedAt: NOW,
      });
      Object.assign(db, { buildReferenceLifecycle: {} });
      vi.spyOn(Retention.prototype, "purge").mockResolvedValue({
        removedBuilds: 0,
        removedFiles: 0,
      });
      const branches = vi
        .spyOn(Retention.prototype, "purgeStaleBranches")
        .mockResolvedValue({ removedBranches: 0, removedBaselines: 0 });
      const app = createShelfApp({
        database: db,
        storage,
        config: { branchTtlDays },
        testing: { runner: stubRunner() },
      });
      const response = await app.request("/api/v1/admin/purge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(response.status).toBe(200);
      expect(branches.mock.calls.length > 0).toBe(removes);
    },
  );
  it("hands the capability read at the start of the pass to every project's purge", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    for (const id of ["p1", "p2"]) {
      // oxlint-disable-next-line no-await-in-loop -- two rows, in order
      await db.insert(db.tables.projects, {
        id,
        name: id,
        slug: id,
        createdAt: NOW,
        updatedAt: NOW,
      });
    }
    const lifecycle = {};
    Object.assign(db, { buildReferenceLifecycle: lifecycle });
    const purge = vi
      .spyOn(Retention.prototype, "purge")
      .mockResolvedValue({ removedBuilds: 0, removedFiles: 0 });
    // The capability goes away as soon as the first project's purge has started.
    purge.mockImplementationOnce(async () => {
      Object.assign(db, { buildReferenceLifecycle: undefined });
      return await Promise.resolve({ removedBuilds: 0, removedFiles: 0 });
    });
    vi.spyOn(Retention.prototype, "purgeStaleBranches").mockResolvedValue({
      removedBranches: 0,
      removedBaselines: 0,
    });
    const app = createShelfApp({ database: db, storage, testing: { runner: stubRunner() } });
    const response = await app.request("/api/v1/admin/purge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(200);
    expect(purge).toHaveBeenCalledTimes(2);
    for (const [, options] of purge.mock.calls) expect(options.lifecycle).toBe(lifecycle);
    expect(await response.json()).toMatchObject({ protected: 0, resumed: 0 });
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
  it("checks authorization before reporting testing retention availability", async () => {
    const { db } = makeDatabase();
    const { storage, objects } = makeStorage();
    await db.insert(db.tables.projects, {
      id: "p",
      name: "P",
      slug: "p",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db.insert(db.tables.builds, {
      id: "old",
      projectId: "p",
      gitSha: "a",
      gitBranch: "main",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const path = "p/builds/old/storybook/index.html";
    objects.set(path, Buffer.from("original"));
    const auth = stubAuth(null, {
      check: async () => ({ id: "viewer", email: "v@example.com", name: "V", role: "viewer" }),
    });
    const app = createShelfApp({ database: db, storage, auth, testing: { runner: stubRunner() } });
    const response = await app.request("/api/v1/admin/purge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(403);
    expect(await db.get(db.tables.builds, "old")).not.toBeNull();
    expect(objects.has(path)).toBe(true);
  });
});
