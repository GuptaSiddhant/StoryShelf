import { describe, expect, it } from "vitest";
import { builds, projects } from "../schema.ts";
import { makeStorage } from "../capture/fake-adapters.ts";
import { makeDatabase } from "./fake-adapters.ts";
import { Retention } from "./purge.ts";

describe("Retention", () => {
  it("purges expired terminal builds", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const now = new Date();

    // Insert a project row so purge can reference it
    const project = {
      id: "p1", name: "Test", slug: "test", gitRepository: null,
      gitDefaultBranch: "main", pixelThreshold: 0.1, maxDiffRatio: 0.01,
      publicBranchRegex: null, createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };
    await db.insert(projects, project);

    // Insert builds: one old approved, one recent approved
    // Old build created 60 days ago
    const oldDate = new Date(now.getTime() - 60 * 86_400_000).toISOString();
    // Recent build created 1 day ago
    const recentDate = new Date(now.getTime() - 1 * 86_400_000).toISOString();

    await db.insert(builds, {
      id: "b-old", projectId: "p1", gitSha: "sha-old", gitBranch: "main",
      isDefault: true, status: "approved", snapshotCount: 0, changedCount: 0,
      approvedCount: 0, rejectedCount: 0, createdAt: oldDate, updatedAt: oldDate,
    });
    await db.insert(builds, {
      id: "b-recent", projectId: "p1", gitSha: "sha-recent", gitBranch: "main",
      isDefault: true, status: "approved", snapshotCount: 0, changedCount: 0,
      approvedCount: 0, rejectedCount: 0, createdAt: recentDate, updatedAt: recentDate,
    });

    const retention = new Retention(db, storage);
    const result = await retention.purge(project, { ttlDays: 30, keepLatestPerBranch: false });

    // B-old should be purged, b-recent should remain
    expect(result.removedBuilds).toBe(1);
    const remaining = await db.list(builds);
    expect(remaining.length).toBe(1);
    expect(remaining[0]?.id).toBe("b-recent");
  });
});
