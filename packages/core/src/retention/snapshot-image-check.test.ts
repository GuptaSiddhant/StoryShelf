import { describe, expect, it } from "vitest";
import { makeDatabase, makeStorage } from "../test-helpers/index.ts";
import { checkSnapshotImages, IMAGE_CHECK_PAGE } from "./snapshot-image-check.ts";

async function seed(retentionState: string, snapshots: number) {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  const now = "2026-11-28T00:00:00.000Z";
  await db.insert(db.tables.builds, {
    id: "b1",
    projectId: "p1",
    gitSha: "s",
    gitBranch: "main",
    status: "approved",
    retentionState,
    createdAt: now,
    updatedAt: now,
  } as never);
  for (let at = 0; at < snapshots; at += 1) {
    // oxlint-disable-next-line no-await-in-loop -- seeding in order keeps the list stable
    await db.insert(db.tables.snapshots, {
      id: `s${String(at).padStart(4, "0")}`,
      projectId: "p1",
      buildId: "b1",
      storyId: `st${at}`,
      storyName: "n",
      storyTitle: "t",
      screenshotPath: `shot${at}.png`,
      comparisonImagePath: `cmp${at}.png`,
      diffPath: `diff${at}.png`,
      createdAt: now,
      updatedAt: now,
    } as never);
    for (const key of [`shot${at}.png`, `cmp${at}.png`, `diff${at}.png`]) {
      objects.set(key, Buffer.from("x"));
    }
  }
  return { deps: { db, storage }, objects };
}

describe("checkSnapshotImages", () => {
  it("is clean when every current, baseline-copy and diff image exists", async () => {
    const w = await seed("available", 2);
    expect(await checkSnapshotImages(w.deps)).toEqual({
      snapshotsChecked: 2,
      missingSnapshotImages: 0,
      buildsMissingImages: [],
    });
  });

  it("counts a missing diff image against its build, without naming a path", async () => {
    const w = await seed("available", 2);
    w.objects.delete("diff1.png");
    const result = await checkSnapshotImages(w.deps);
    expect(result).toMatchObject({ missingSnapshotImages: 1, buildsMissingImages: ["b1"] });
    expect(JSON.stringify(result)).not.toContain("diff1");
  });

  it("skips builds that are not available, and pages through many snapshots", async () => {
    const gone = await seed("deleting", 1);
    gone.objects.clear();
    expect((await checkSnapshotImages(gone.deps)).snapshotsChecked).toBe(0);
    const many = await seed("available", IMAGE_CHECK_PAGE + 1);
    many.objects.delete(`shot${IMAGE_CHECK_PAGE}.png`);
    expect(await checkSnapshotImages(many.deps)).toMatchObject({
      snapshotsChecked: IMAGE_CHECK_PAGE + 1,
      missingSnapshotImages: 1,
    });
  });
});
