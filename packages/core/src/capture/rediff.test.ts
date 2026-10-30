import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";
import { createLatch, deferred } from "../test-helpers/index.ts";
import { makeDatabase, makeStorage } from "../test-helpers/index.ts";
import { PERSIST_CONCURRENCY } from "./pipeline.ts";
import { rediffBuild } from "./rediff.ts";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";

const project = {
  id: "p1",
  name: "P",
  slug: "p",
  gitRepository: null,
  gitDefaultBranch: "main",
  pixelThreshold: 0.1,
  maxDiffRatio: 0.01,
  publicBranchRegex: null,
  executePlay: false,
  playTimeoutMs: 10_000,
  storybookMeta: null,
  createdAt: T1,
  updatedAt: T1,
} as Project;

const build = {
  id: "f1",
  projectId: "p1",
  gitSha: "sha",
  gitBranch: "feature/x",
  isDefault: false,
  status: "reviewing",
  createdAt: T1,
  updatedAt: T1,
} as Build;

function png(rgb: [number, number, number]): Buffer {
  const image = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = rgb[0];
    image.data[i + 1] = rgb[1];
    image.data[i + 2] = rgb[2];
    image.data[i + 3] = 255;
  }
  return PNG.sync.write(image);
}

const RED: [number, number, number] = [255, 0, 0];
const GREEN: [number, number, number] = [0, 255, 0];

async function setup(snapshot: Record<string, unknown> = {}) {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  await db.insert(db.tables.builds, build);
  await db.insert(db.tables.baselines, {
    id: "bl-main",
    projectId: "p1",
    storyId: "a",
    viewportName: "desktop",
    branch: "main",
    snapshotId: "s0",
    screenshotPath: "baselines/main/a.png",
    createdAt: T1,
    updatedAt: T2,
  });
  objects.set("baselines/main/a.png", png(GREEN));
  objects.set("shots/a.png", png(GREEN));
  await db.insert(db.tables.snapshots, {
    id: "s1",
    projectId: "p1",
    buildId: "f1",
    storyId: "a",
    storyName: "A",
    storyTitle: "T",
    viewportName: "desktop",
    screenshotPath: "shots/a.png",
    status: "changed",
    baselineId: "bl-main",
    baselineVersion: T1,
    inherited: false,
    createdAt: T1,
    updatedAt: T1,
    ...snapshot,
  });
  return { db, storage, objects };
}

describe("rediffBuild", () => {
  it("clears a stale change once the baseline caught up and records the new baseline", async () => {
    const { db, storage } = await setup();

    const result = await rediffBuild({ db, storage }, project, build);

    expect(result).toEqual({ rediffed: 1, statusChanged: 1, missingScreenshots: [] });
    const row = await db.get(db.tables.snapshots, "s1");
    expect(row?.status).toBe("unchanged");
    expect(row?.diffPassed).toBe(true);
    expect(row?.baselineVersion).toBe(T2);
  });

  it("freezes the new reference and removes the previous owned copy after rediff", async () => {
    const old = "p1/builds/f1/comparisons/01ARZ3NDEKTSV4RRFFQ69G5FAV.png";
    const { db, storage, objects } = await setup({ comparisonImagePath: old });
    objects.set(old, Buffer.from("previous"));
    await rediffBuild({ db, storage }, project, build);
    const row = await db.get(db.tables.snapshots, "s1");
    expect(row?.comparisonImagePath).not.toBe(old);
    expect(objects.has(old)).toBe(false);
    expect(await storage.read(row?.comparisonImagePath as string)).toEqual(png(GREEN));
    expect(JSON.parse(row?.comparisonMetadata as string)).toMatchObject({
      baselineVersion: T2,
      width: null,
      height: null,
    });
  });

  it("flags a previously unchanged snapshot when the baseline moved away from it", async () => {
    const { db, storage, objects } = await setup({ status: "unchanged" });
    objects.set("baselines/main/a.png", png(RED));

    const result = await rediffBuild({ db, storage }, project, build);

    expect(result.statusChanged).toBe(1);
    const row = await db.get(db.tables.snapshots, "s1");
    expect(row?.status).toBe("changed");
    expect(row?.diffPath).toBe("p1/builds/f1/diffs/a/desktop.png");
    expect(objects.has("p1/builds/f1/diffs/a/desktop.png")).toBe(true);
  });

  it.each([{ status: "approved" }, { status: "rejected" }, { inherited: true }])(
    "leaves decided or inherited snapshots untouched (%o)",
    async (patch) => {
      const { db, storage, objects } = await setup(patch);
      objects.set("baselines/main/a.png", png(RED));

      const result = await rediffBuild({ db, storage }, project, build);

      expect(result.rediffed).toBe(0);
      expect((await db.get(db.tables.snapshots, "s1"))?.baselineVersion).toBe(T1);
    },
  );

  it("reports snapshots whose stored screenshot is missing without changing them", async () => {
    const { db, storage, objects } = await setup();
    objects.delete("shots/a.png");

    const result = await rediffBuild({ db, storage }, project, build);

    expect(result).toEqual({ rediffed: 0, statusChanged: 0, missingScreenshots: ["s1"] });
    expect((await db.get(db.tables.snapshots, "s1"))?.status).toBe("changed");
  });

  it("keeps a new story new when it still has no baseline, tracked as none", async () => {
    const { db, storage } = await setup({
      storyId: "z",
      status: "new",
      baselineId: null,
      baselineVersion: "none",
    });

    await rediffBuild({ db, storage }, project, build);

    const row = await db.get(db.tables.snapshots, "s1");
    expect(row?.status).toBe("new");
    expect(row?.baselineVersion).toBe("none");
  });

  it("diffs a new story that gained a baseline since capture", async () => {
    const { db, storage } = await setup({
      status: "new",
      baselineId: null,
      baselineVersion: "none",
    });

    await rediffBuild({ db, storage }, project, build);

    const row = await db.get(db.tables.snapshots, "s1");
    expect(row?.status).toBe("unchanged");
    expect(row?.baselineId).toBe("bl-main");
  });

  it("bounds how many snapshots are diffed at once", async () => {
    const { db, storage, objects } = await setup();
    const count = PERSIST_CONCURRENCY * 4;
    const ids = Array.from({ length: count }, (_unused, index) => `extra-${index}`);
    await Promise.all(
      ids.map(async (id) => {
        objects.set(`baselines/main/${id}.png`, png(GREEN));
        objects.set(`shots/${id}.png`, png(GREEN));
        await db.insert(db.tables.baselines, {
          id: `bl-${id}`,
          projectId: "p1",
          storyId: id,
          viewportName: "desktop",
          branch: "main",
          snapshotId: "s0",
          screenshotPath: `baselines/main/${id}.png`,
          createdAt: T1,
          updatedAt: T2,
        });
        await db.insert(db.tables.snapshots, {
          id,
          projectId: "p1",
          buildId: "f1",
          storyId: id,
          storyName: id,
          storyTitle: "T",
          viewportName: "desktop",
          screenshotPath: `shots/${id}.png`,
          status: "changed",
          baselineId: `bl-${id}`,
          baselineVersion: T1,
          inherited: false,
          createdAt: T1,
          updatedAt: T1,
        });
      }),
    );

    let inFlight = 0;
    let peak = 0;
    const latch = createLatch();
    const full = deferred();
    const read = storage.read.bind(storage);
    storage.read = async (path) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      if (inFlight === PERSIST_CONCURRENCY) full.resolve();
      await latch.wait();
      inFlight -= 1;
      return await read(path);
    };

    const result = rediffBuild({ db, storage }, project, build);
    await full.promise;
    expect(inFlight).toBe(PERSIST_CONCURRENCY);
    latch.open();

    expect(await result).toMatchObject({ rediffed: count + 1 });
    expect(peak).toBe(PERSIST_CONCURRENCY);
  });
});
