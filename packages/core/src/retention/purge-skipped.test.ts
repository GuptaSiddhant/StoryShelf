import { describe, expect, it } from "vitest";
import type { BuildReferenceLifecycle, DeletingBuild } from "../adapters/database.ts";
import { BuildModel } from "../models/build.ts";
import { createTestBuild, createTestProject } from "../test-helpers/create-project.ts";
import { makeDatabase } from "../test-helpers/fake-database.ts";
import { makeStorage } from "../test-helpers/fake-storage.ts";
import { purgeClaimedBuilds } from "./purge-claimed.ts";
import { Retention } from "./purge.ts";

const DAY = 86_400_000;

/** A lifecycle that tombstones in memory and removes the row on completion, for the fake database. */
function memoryLifecycle(db: ReturnType<typeof makeDatabase>["db"]) {
  const deleting = new Map<string, DeletingBuild>();
  const lifecycle = {
    claimDeletion: (projectId: string, buildId: string) => {
      deleting.set(buildId, { projectId, buildId, contentReleased: false, storageDeleted: false });
      return Promise.resolve("claimed");
    },
    listDeleting: () => Promise.resolve([...deleting.values()]),
    releaseBuildContent: () => Promise.resolve("done"),
    markStorageDeleted: () => Promise.resolve("done"),
    completeDeletion: async (_project: string, buildId: string) => {
      await db.remove(db.tables.builds, buildId);
      deleting.delete(buildId);
      return "done";
    },
  } as unknown as BuildReferenceLifecycle;
  return { lifecycle, deleting };
}

async function seed(skipped: number) {
  const { db } = makeDatabase();
  const project = await createTestProject(db, db.tables);
  const source = await createTestBuild(db, db.tables, project.id, { gitSha: "src" });
  const builds = new BuildModel(db, db.tables);
  const kids: string[] = [];
  for (let i = 0; i < skipped; i += 1) {
    // oxlint-disable-next-line no-await-in-loop -- seeded in order
    const kid = await builds.createSkipped({
      projectId: project.id,
      gitSha: `skip-${i}`,
      gitBranch: `branch-${i}`,
      sourceBuildId: source.id,
      changedFiles: [],
    });
    kids.push(kid.id);
  }
  const old = new Date(Date.now() - 60 * DAY).toISOString();
  for (const id of [source.id, ...kids]) {
    // oxlint-disable-next-line no-await-in-loop -- one row at a time
    await db.update(db.tables.builds, id, { updatedAt: old });
  }
  return { db, project, sourceId: source.id, kids };
}

describe("retention of skipped builds on the fake database", () => {
  it("deletes the builds skipped from a purged source, skipped builds first", async () => {
    const { db, project, sourceId, kids } = await seed(2);
    const { lifecycle } = memoryLifecycle(db);
    const order: string[] = [];
    const result = await purgeClaimedBuilds(
      {
        db,
        storage: makeStorage().storage,
        lifecycle,
        afterStep: (step, id) => {
          if (step === "rows") order.push(id);
        },
      },
      project.id,
      [sourceId],
    );
    expect(result.removedBuilds).toBe(3);
    expect(order.at(-1)).toBe(sourceId);
    expect(new Set(order)).toEqual(new Set([sourceId, ...kids]));
  });

  it("purging a skipped build claims nothing else", async () => {
    const { db, project, kids } = await seed(1);
    const { lifecycle, deleting } = memoryLifecycle(db);
    await purgeClaimedBuilds({ db, storage: makeStorage().storage, lifecycle }, project.id, [
      kids[0] as string,
    ]);
    expect(deleting.size).toBe(0);
    expect(await db.get(db.tables.builds, kids[0] as string)).toBeNull();
  });

  it("keeps a source and its row while a skipped build from it is kept by the pass", async () => {
    const { db, project, sourceId, kids } = await seed(2);
    await db.update(db.tables.builds, kids[1] as string, { updatedAt: new Date().toISOString() });
    const { lifecycle } = memoryLifecycle(db);
    const retention = new Retention(db, makeStorage().storage, {
      builds: db.tables.builds,
      buildLabels: db.tables.buildLabels,
      baselines: db.tables.baselines,
    });
    const result = await retention.purge(project, {
      ttlDays: 30,
      keepLatestPerBranch: false,
      lifecycle,
    });
    expect(result.removedBuilds).toBe(1);
    expect(await db.get(db.tables.builds, sourceId)).not.toBeNull();
    expect(await db.get(db.tables.builds, kids[1] as string)).not.toBeNull();
  });

  it("keeps a source whose skipped build is persistent or the latest on its branch", async () => {
    const { db, project, sourceId, kids } = await seed(1);
    const { lifecycle } = memoryLifecycle(db);
    const retention = new Retention(db, makeStorage().storage, {
      builds: db.tables.builds,
      buildLabels: db.tables.buildLabels,
      baselines: db.tables.baselines,
    });
    const result = await retention.purge(project, {
      ttlDays: 30,
      keepLatestPerBranch: true,
      lifecycle,
    });
    // The skipped build is the latest on its own branch, so it stays and pins the old source.
    expect(await db.get(db.tables.builds, kids[0] as string)).not.toBeNull();
    expect(await db.get(db.tables.builds, sourceId)).not.toBeNull();
    expect(result.removedBuilds).toBe(0);
  });
});
