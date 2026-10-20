import { describe, expect, it } from "vitest";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import { contentPath } from "../utils/paths.ts";
import { storeScreenshot, withContentClaim } from "../utils/screenshot-store.ts";
import { sweepScreenshotContent, SWEEP_GRACE_MS } from "./screenshot-sweep.ts";

const STAMP = "2026-01-01T00:00:00.000Z";
const H = (letter: string): string => letter.repeat(64);

async function world() {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  const deps = {
    db,
    storage,
    tables: {
      snapshots: db.tables.snapshots,
      baselines: db.tables.baselines,
      builds: db.tables.builds,
    },
  };
  const put = (hash: string, project = "p1"): string => {
    const path = contentPath(project, hash);
    objects.set(path, Buffer.from(hash));
    return path;
  };
  const snapshotAt = async (path: string, project = "p1"): Promise<void> => {
    await db.insert(db.tables.snapshots, {
      id: `s-${path}`,
      projectId: project,
      buildId: "b1",
      storyId: "a",
      storyName: "A",
      storyTitle: "T",
      viewportName: "desktop",
      screenshotPath: path,
      status: "unchanged",
      createdAt: STAMP,
      updatedAt: STAMP,
    });
  };
  const baselineAt = async (path: string, project = "p1"): Promise<void> => {
    await db.insert(db.tables.baselines, {
      id: `bl-${path}`,
      projectId: project,
      storyId: "a",
      viewportName: "desktop",
      branch: "main",
      screenshotPath: path,
      browser: "chromium",
      createdAt: STAMP,
      updatedAt: STAMP,
    });
  };
  const buildAt = async (status: string, updatedAt: number, project = "p1"): Promise<string> => {
    const id = `b-${status}-${updatedAt}`;
    await db.insert(db.tables.builds, {
      id,
      projectId: project,
      status,
      createdAt: STAMP,
      updatedAt: new Date(updatedAt).toISOString(),
    });
    return id;
  };
  return { deps, storage, objects, put, snapshotAt, baselineAt, buildAt };
}

describe("sweepScreenshotContent", () => {
  it("keeps referenced screenshots, whether a snapshot or a baseline points at them", async () => {
    const { deps, objects, put, snapshotAt, baselineAt } = await world();
    await snapshotAt(put(H("a")));
    await baselineAt(put(H("b")));
    const later = Date.now() + 10 * SWEEP_GRACE_MS;
    await sweepScreenshotContent(deps, "p1", { now: Date.now() });
    const result = await sweepScreenshotContent(deps, "p1", { now: later });
    expect(result.removed).toBe(0);
    expect(objects.has(contentPath("p1", H("a")))).toBe(true);
    expect(objects.has(contentPath("p1", H("b")))).toBe(true);
  });

  it("does not delete an unreferenced screenshot the first time it sees it", async () => {
    const { deps, objects, put } = await world();
    const path = put(H("c"));
    const result = await sweepScreenshotContent(deps, "p1", { now: 1_000 });
    expect(result).toEqual({ removed: 0, pending: 1 });
    expect(objects.has(path)).toBe(true);
  });

  it("deletes it once it has stayed unreferenced for the whole grace period", async () => {
    const { deps, objects, put } = await world();
    const path = put(H("c"));
    await sweepScreenshotContent(deps, "p1", { now: 1_000 });
    const early = await sweepScreenshotContent(deps, "p1", { now: 1_000 + SWEEP_GRACE_MS - 1 });
    expect(early.removed).toBe(0);
    const due = await sweepScreenshotContent(deps, "p1", { now: 1_000 + SWEEP_GRACE_MS });
    expect(due).toEqual({ removed: 1, pending: 0 });
    expect(objects.has(path)).toBe(false);
  });

  it("forgets a candidate that became referenced again before the grace ended", async () => {
    const { deps, objects, put, snapshotAt } = await world();
    const path = put(H("d"));
    await sweepScreenshotContent(deps, "p1", { now: 1_000 });
    await snapshotAt(path); // a new capture reused the object
    const result = await sweepScreenshotContent(deps, "p1", { now: 1_000 + 2 * SWEEP_GRACE_MS });
    expect(result.removed).toBe(0);
    expect(objects.has(path)).toBe(true);
    // And its clock restarts if it is orphaned later.
    await deps.db.remove(deps.db.tables.snapshots, `s-${path}`);
    const after = await sweepScreenshotContent(deps, "p1", { now: 1_000 + 2 * SWEEP_GRACE_MS + 5 });
    expect(after.removed).toBe(0);
    expect(after.pending).toBe(1);
  });

  it("re-checks the database right before deleting", async () => {
    const { deps, objects, put, snapshotAt } = await world();
    const path = put(H("e"));
    await sweepScreenshotContent(deps, "p1", { now: 1_000 });
    // A capture references the object after the sweep's scan but before its delete: the first
    // limited query is the re-check, so reference the object just before it runs.
    let referencedLate = false;
    const list = deps.db.list.bind(deps.db);
    deps.db.list = (async (...args: Parameters<typeof list>) => {
      if (!referencedLate && args[1] && "limit" in args[1]) {
        referencedLate = true;
        await snapshotAt(path);
      }
      return await list(...args);
    }) as typeof list;
    const result = await sweepScreenshotContent(deps, "p1", { now: 1_000 + SWEEP_GRACE_MS });
    expect(referencedLate).toBe(true);
    expect(result.removed).toBe(0);
    expect(objects.has(path)).toBe(true);
  });

  it("leaves other projects, non-screenshot files and legacy paths alone", async () => {
    const { deps, objects, put } = await world();
    const other = put(H("f"), "p2");
    objects.set("p1/builds/b1/screenshots/a/desktop.png", Buffer.from("legacy"));
    objects.set("p1/baselines/main/a/desktop.png", Buffer.from("legacy"));
    await sweepScreenshotContent(deps, "p1", { now: 1_000 });
    await sweepScreenshotContent(deps, "p1", { now: 1_000 + 2 * SWEEP_GRACE_MS });
    expect(objects.has(other)).toBe(true);
    expect(objects.has("p1/builds/b1/screenshots/a/desktop.png")).toBe(true);
    expect(objects.has("p1/baselines/main/a/desktop.png")).toBe(true);
  });

  it("survives a missing or corrupt marker", async () => {
    const { deps, objects, put } = await world();
    const path = put(H("g"));
    objects.set("p1/content/.sweep.json", Buffer.from("not json"));
    const result = await sweepScreenshotContent(deps, "p1", { now: 1_000 });
    expect(result).toEqual({ removed: 0, pending: 1 });
    expect(objects.has(path)).toBe(true);
  });
});

describe("sweepScreenshotContent with reuse in flight", () => {
  const T0 = Date.parse("2026-06-01T00:00:00.000Z");
  const DUE = T0 + SWEEP_GRACE_MS + 60 * 60 * 1000;
  const BYTES = Buffer.from("same pixels");

  it("keeps an object a capturing build just reused, until the build settles", async () => {
    const { deps, storage, objects, buildAt } = await world();
    const path = await storeScreenshot(storage, "p1", BYTES);
    await sweepScreenshotContent(deps, "p1", { now: T0 });

    // A rebuild renders the same bytes: the write is skipped, and no row exists yet.
    const build = await buildAt("capturing", DUE - 1000);
    expect(await storeScreenshot(storage, "p1", BYTES)).toBe(path);
    const during = await sweepScreenshotContent(deps, "p1", { now: DUE });
    expect(during).toEqual({ removed: 0, pending: 1 });
    expect(objects.has(path)).toBe(true);

    // Once the build is terminal (and still nothing references it), the object goes.
    await deps.db.update(deps.db.tables.builds, build, { status: "failed" });
    expect((await sweepScreenshotContent(deps, "p1", { now: DUE })).removed).toBe(1);
  });

  it("ignores builds of other projects and builds stuck past the grace period", async () => {
    const { deps, objects, put, buildAt } = await world();
    const path = put(H("h"));
    await sweepScreenshotContent(deps, "p1", { now: T0 });
    await buildAt("capturing", DUE, "p2");
    await buildAt("pending", DUE - SWEEP_GRACE_MS - 1);
    expect((await sweepScreenshotContent(deps, "p1", { now: DUE })).removed).toBe(1);
    expect(objects.has(path)).toBe(false);
  });

  it("keeps everything while a reuse claim is held, and ignores a stale claim", async () => {
    const { deps, storage, objects, put } = await world();
    const path = put(H("i"));
    await sweepScreenshotContent(deps, "p1", { now: T0 });
    const during = await withContentClaim(
      storage,
      "p1",
      async () =>
        await sweepScreenshotContent(deps, "p1", { now: Date.now() + SWEEP_GRACE_MS / 2 }),
    );
    expect(during.removed).toBe(0);
    expect(objects.has(path)).toBe(true);
    // The claim is released afterwards; a crash-left claim older than the grace does not block.
    expect([...objects.keys()].some((key) => key.includes("/.claims/"))).toBe(false);
    objects.set("p1/content/.claims/old.json", Buffer.from(JSON.stringify({ at: T0 })));
    expect((await sweepScreenshotContent(deps, "p1", { now: DUE })).removed).toBe(1);
  });
});
