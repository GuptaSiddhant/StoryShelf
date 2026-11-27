import type { Build, Project } from "@storyshelf/core/schema";
import { makeDatabase } from "@storyshelf/core/test-helpers";
import { describe, expect, it } from "vitest";
import { loadEarlierVerdict } from "./earlier-verdict.ts";

const T = (n: number): string => `2026-01-0${n}T00:00:00.000Z`;

async function setup(earlierStatus: string, snapStatus: string, branch = "feature/y") {
  const { db } = makeDatabase();
  const project = { id: "p1", slug: "kit" } as Project;
  const base = {
    projectId: "p1",
    gitSha: "sha",
    isDefault: false,
    authorEmail: null,
    authorName: null,
    message: null,
    public: false,
    snapshotCount: 1,
    changedCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    inheritedCount: 0,
    affectedOnly: true,
    baselineSha: null,
    changedFiles: null,
    affectedImportPaths: null,
    updatedAt: T(1),
  };
  await db.insert(db.tables.builds, {
    ...base,
    id: "old",
    gitBranch: branch,
    status: earlierStatus,
    createdAt: T(1),
  } as Build);
  await db.insert(db.tables.builds, {
    ...base,
    id: "new",
    gitBranch: "feature/y",
    status: "reviewing",
    createdAt: T(2),
  } as Build);
  const snap = (id: string, buildId: string, status: string) => ({
    id,
    projectId: "p1",
    buildId,
    storyId: "s",
    storyName: "S",
    storyTitle: "T",
    viewportName: "desktop",
    browser: "chromium",
    screenshotPath: "x.png",
    status,
    baselineId: null,
    baselineVersion: null,
    createdAt: T(1),
    updatedAt: T(1),
  });
  await db.insert(db.tables.snapshots, snap("os", "old", snapStatus) as never);
  await db.insert(db.tables.snapshots, snap("ns", "new", "changed") as never);
  await db.insert(db.tables.comments, {
    id: "c1",
    projectId: "p1",
    buildId: "old",
    snapshotId: "os",
    body: "Fix",
    kind: "change_request",
    resolved: false,
    createdAt: T(1),
    updatedAt: T(1),
  });
  const build = (await db.get(db.tables.builds, "new")) as unknown as Build;
  const selected = (await db.get(db.tables.snapshots, "ns")) as never;
  return { db, project, build, selected };
}

describe("loadEarlierVerdict", () => {
  it("returns the earlier rejection and its open change request", async () => {
    const { db, project, build, selected } = await setup("reviewing", "rejected");
    const found = await loadEarlierVerdict(db, project, build, selected);
    expect(found?.verdict).toBe("rejected");
    expect(found?.build.id).toBe("old");
    expect(found?.openChangeRequests).toHaveLength(1);
  });

  it.each(["cancelled", "failed"])(
    "treats a %s earlier build as having no verdict",
    async (status) => {
      const { db, project, build, selected } = await setup(status, "rejected");
      expect(await loadEarlierVerdict(db, project, build, selected)).toBeNull();
    },
  );

  it("ignores another branch", async () => {
    const { db, project, build, selected } = await setup("reviewing", "rejected", "other");
    expect(await loadEarlierVerdict(db, project, build, selected)).toBeNull();
  });
});
