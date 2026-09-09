import { describe, expect, it } from "vitest";
import { baselines, buildLabels, builds, projects } from "../../../db-sqlite/src/schema/index.ts";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import { Retention } from "./purge.ts";

function retentionTables() {
  return {
    builds: builds as unknown as never,
    buildLabels: buildLabels as unknown as never,
    baselines: baselines as unknown as never,
  };
}

function baselineTables() {
  return { baselines: baselines as unknown as never };
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
    await db.insert(projects, project);

    // Insert builds: one old approved, one recent approved
    // Old build created 60 days ago
    const oldDate = new Date(now.getTime() - 60 * 86_400_000).toISOString();
    // Recent build created 1 day ago
    const recentDate = new Date(now.getTime() - 1 * 86_400_000).toISOString();

    await db.insert(builds, {
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
    await db.insert(builds, {
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

    const retention = new Retention(db, storage, retentionTables());
    const result = await retention.purge(project, { ttlDays: 30, keepLatestPerBranch: false });

    // B-old should be purged, b-recent should remain
    expect(result.removedBuilds).toBe(1);
    const remaining = await db.list(builds);
    expect(remaining.length).toBe(1);
    expect(remaining[0]?.id).toBe("b-recent");
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
    await db.insert(projects, project);

    const oldDate = new Date(now.getTime() - 40 * 86_400_000).toISOString();
    const recentDate = new Date(now.getTime() - 5 * 86_400_000).toISOString();

    await db.insert(builds, {
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
    await db.insert(builds, {
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
    await db.insert(builds, {
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
    const baselineModel = new BaselineModel(db, baselineTables(), storage);
    await storage.write("src.png", Buffer.from([1]));
    await baselineModel.upsert("p1", "s1", "desktop", "feature/stale", "snap1", "src.png");
    await baselineModel.upsert("p1", "s1", "desktop", "feature/fresh", "snap2", "src.png");
    await baselineModel.upsert("p1", "s1", "desktop", "main", "snap3", "src.png");

    const retention = new Retention(db, storage, retentionTables());
    const result = await retention.purgeStaleBranches(project, 30);
    expect(result.removedBranches).toBe(1);
    expect(result.removedBaselines).toBe(1);
    const remaining = await baselineModel.list("p1");
    expect(remaining.map((b) => b.branch).toSorted()).toEqual(["feature/fresh", "main"]);
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
    await db.insert(projects, project);
    const oldDate = new Date(now.getTime() - 40 * 86_400_000).toISOString();
    await db.insert(builds, {
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
    const baselineModel = new BaselineModel(db, baselineTables(), storage);
    await storage.write("src.png", Buffer.from([1]));
    await baselineModel.upsert("p1", "s1", "desktop", "main", "snap1", "src.png");
    const retention = new Retention(db, storage, retentionTables());
    const result = await retention.purgeStaleBranches(project, 30);
    expect(result.removedBranches).toBe(0);
    expect(result.removedBaselines).toBe(0);
  });
});
