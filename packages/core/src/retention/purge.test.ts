import { describe, expect, it } from "vitest";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { LabelModel } from "../models/label.ts";
import { PackageUsageModel } from "../models/usage.ts";
import { createTestProject } from "../test-helpers/create-project.ts";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import { Retention } from "./purge.ts";

function retentionTables(db: DatabaseAdapter) {
  return {
    builds: db.tables.builds,
    buildLabels: db.tables.buildLabels,
    baselines: db.tables.baselines,
  };
}

function baselineTables(db: DatabaseAdapter) {
  return { baselines: db.tables.baselines };
}

describe("Retention", () => {
  it("purges expired terminal builds", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const now = new Date();

    // Insert a project row so purge can reference it
    const project = {
      id: "p1",
      name: "Test",
      slug: "test",
      gitRepository: null,
      gitDefaultBranch: "main",
      pixelThreshold: 0.1,
      maxDiffRatio: 0.01,
      publicBranchRegex: null,
      executePlay: false,
      playTimeoutMs: 10_000,
      storybookMeta: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await db.insert(db.tables.projects, project);

    // Insert builds: one old approved, one recent approved
    // Old build created 60 days ago
    const oldDate = new Date(now.getTime() - 60 * 86_400_000).toISOString();
    // Recent build created 1 day ago
    const recentDate = new Date(now.getTime() - 1 * 86_400_000).toISOString();

    await db.insert(db.tables.builds, {
      id: "b-old",
      projectId: "p1",
      gitSha: "sha-old",
      gitBranch: "main",
      isDefault: true,
      status: "approved",
      snapshotCount: 0,
      changedCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      createdAt: oldDate,
      updatedAt: oldDate,
    });
    await db.insert(db.tables.builds, {
      id: "b-recent",
      projectId: "p1",
      gitSha: "sha-recent",
      gitBranch: "main",
      isDefault: true,
      status: "approved",
      snapshotCount: 0,
      changedCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      createdAt: recentDate,
      updatedAt: recentDate,
    });

    const usage = new PackageUsageModel(db);
    const usageRow = {
      storyImportPath: "src/Card.stories.tsx",
      packageName: "@acme/ds",
      modulePath: "node_modules/@acme/ds/dist/Button.js",
    };
    await usage.replaceForBuild("p1", "b-old", [usageRow]);
    await usage.replaceForBuild("p1", "b-recent", [usageRow]);

    const retention = new Retention(db, storage, retentionTables(db));
    const result = await retention.purge(project, { ttlDays: 30, keepLatestPerBranch: false });

    // B-old should be purged, b-recent should remain
    expect(result.removedBuilds).toBe(1);
    const remaining = await db.list(db.tables.builds);
    expect(remaining.length).toBe(1);
    expect(remaining[0]?.id).toBe("b-recent");
    // Usage rows go with the build explicitly (the fake has no FK cascade)
    expect(await usage.listForBuild("b-old")).toEqual([]);
    expect(await usage.listForBuild("b-recent")).toHaveLength(1);
  });

  it("keeps persistent builds and purges the rest", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const project = await createTestProject(db, db.tables);
    const insertBuild = async (id: string): Promise<unknown> =>
      await db.insert(db.tables.builds, {
        id,
        projectId: project.id,
        gitSha: id,
        gitBranch: "main",
        isDefault: false,
        status: "approved",
        snapshotCount: 0,
        changedCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
        createdAt: old,
        updatedAt: old,
      });
    await Promise.all(["b-persistent", "b-plain"].map((id) => insertBuild(id)));
    await new LabelModel(db).attach(project.id, "b-persistent", "persistent", "true");

    const retention = new Retention(db, storage, retentionTables(db));
    const result = await retention.purge(project, { ttlDays: 30, keepLatestPerBranch: false });

    expect(result.removedBuilds).toBe(1);
    expect((await db.list(db.tables.builds)).map((row) => row.id)).toEqual(["b-persistent"]);
  });

  it("purges stale baseline branches via TTL", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const now = new Date();
    const project = {
      id: "p1",
      name: "Test",
      slug: "test",
      gitRepository: null,
      gitDefaultBranch: "main",
      pixelThreshold: 0.1,
      maxDiffRatio: 0.01,
      publicBranchRegex: null,
      executePlay: false,
      playTimeoutMs: 10_000,
      storybookMeta: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await db.insert(db.tables.projects, project);

    const oldDate = new Date(now.getTime() - 40 * 86_400_000).toISOString();
    const recentDate = new Date(now.getTime() - 5 * 86_400_000).toISOString();

    await db.insert(db.tables.builds, {
      id: "b-stale",
      projectId: "p1",
      gitSha: "sha-stale",
      gitBranch: "feature/stale",
      isDefault: false,
      status: "approved",
      snapshotCount: 0,
      changedCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      createdAt: oldDate,
      updatedAt: oldDate,
    });
    await db.insert(db.tables.builds, {
      id: "b-fresh",
      projectId: "p1",
      gitSha: "sha-fresh",
      gitBranch: "feature/fresh",
      isDefault: false,
      status: "approved",
      snapshotCount: 0,
      changedCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      createdAt: recentDate,
      updatedAt: recentDate,
    });
    await db.insert(db.tables.builds, {
      id: "b-main",
      projectId: "p1",
      gitSha: "sha-main",
      gitBranch: "main",
      isDefault: true,
      status: "approved",
      snapshotCount: 0,
      changedCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      createdAt: oldDate,
      updatedAt: oldDate,
    });

    const { BaselineModel } = await import("../models/baseline.ts");
    const baselineModel = new BaselineModel(db, baselineTables(db), storage);
    await storage.write("src.png", Buffer.from([1]));
    await baselineModel.upsert("p1", "s1", "desktop", "feature/stale", "snap1", "src.png");
    await baselineModel.upsert("p1", "s1", "desktop", "feature/fresh", "snap2", "src.png");
    await baselineModel.upsert("p1", "s1", "desktop", "main", "snap3", "src.png");

    const retention = new Retention(db, storage, retentionTables(db));
    const result = await retention.purgeStaleBranches(project, 30);
    expect(result.removedBranches).toBe(1);
    expect(result.removedBaselines).toBe(1);
    const remaining = await baselineModel.list("p1");
    // oxlint-disable-next-line unicorn/no-array-sort, unicorn/no-useless-spread -- toSorted not available in type-aware lint lib
    expect([...remaining.map((b) => b.branch)].sort()).toEqual(["feature/fresh", "main"]);
  });

  it("never purges the default branch", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const now = new Date();
    const project = {
      id: "p1",
      name: "Test",
      slug: "test",
      gitRepository: null,
      gitDefaultBranch: "main",
      pixelThreshold: 0.1,
      maxDiffRatio: 0.01,
      publicBranchRegex: null,
      executePlay: false,
      playTimeoutMs: 10_000,
      storybookMeta: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await db.insert(db.tables.projects, project);
    const oldDate = new Date(now.getTime() - 40 * 86_400_000).toISOString();
    await db.insert(db.tables.builds, {
      id: "b-main",
      projectId: "p1",
      gitSha: "sha-main",
      gitBranch: "main",
      isDefault: true,
      status: "approved",
      snapshotCount: 0,
      changedCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      createdAt: oldDate,
      updatedAt: oldDate,
    });
    const { BaselineModel } = await import("../models/baseline.ts");
    const baselineModel = new BaselineModel(db, baselineTables(db), storage);
    await storage.write("src.png", Buffer.from([1]));
    await baselineModel.upsert("p1", "s1", "desktop", "main", "snap1", "src.png");
    const retention = new Retention(db, storage, retentionTables(db));
    const result = await retention.purgeStaleBranches(project, 30);
    expect(result.removedBranches).toBe(0);
    expect(result.removedBaselines).toBe(0);
  });

  it("sweeps unreferenced content-addressed screenshots after a purge, and never fails it", async () => {
    const { db } = makeDatabase();
    const { storage, objects } = makeStorage();
    const now = new Date().toISOString();
    const project = {
      id: "p1",
      name: "Test",
      slug: "test",
      gitRepository: null,
      gitDefaultBranch: "main",
      pixelThreshold: 0.1,
      maxDiffRatio: 0.01,
      publicBranchRegex: null,
      executePlay: false,
      playTimeoutMs: 10_000,
      storybookMeta: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(db.tables.projects, project);
    objects.set("p1/content/" + "a".repeat(64) + ".png", Buffer.from("orphan"));
    const retention = new Retention(db, storage, retentionTables(db));

    await retention.purge(project as never, { ttlDays: 30, keepLatestPerBranch: true });

    // First sighting: kept, and remembered so a later purge can reclaim it.
    expect(objects.has("p1/content/" + "a".repeat(64) + ".png")).toBe(true);
    expect(objects.has("p1/content/.sweep.json")).toBe(true);

    storage.list = async () => {
      throw new Error("storage down");
    };
    await expect(
      retention.purge(project as never, { ttlDays: 30, keepLatestPerBranch: true }),
    ).resolves.toBeDefined();
  });
});
