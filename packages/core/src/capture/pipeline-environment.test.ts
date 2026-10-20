import { PNG } from "pngjs";
import { describe, expect, it, vi } from "vitest";
import type { CaptureEnvironment, RenderedSnapshot } from "../adapters/capture-runner.ts";
import type { Baseline } from "../schema/baseline.ts";
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import type { EnvironmentChange } from "./fingerprint.ts";
import { persistCapture, type CaptureContext } from "./pipeline.ts";

const VIEWPORT = { name: "desktop", width: 1280, height: 720 };
const STAMP = "2026-01-01T00:00:00.000Z";

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
  createdAt: STAMP,
  updatedAt: STAMP,
} as Project;

const ENV_A: CaptureEnvironment = {
  browserVersion: "124.0.1",
  platform: "linux-x64",
  deviceScaleFactor: 1,
  fontsHash: "fonts-a",
};
const ENV_B: CaptureEnvironment = { ...ENV_A, browserVersion: "126.0.0" };

function png(rgb: [number, number, number], width = 4): Buffer {
  const image = new PNG({ width, height: 4 });
  for (let index = 0; index < image.data.length; index += 4) {
    [image.data[index], image.data[index + 1], image.data[index + 2]] = rgb;
    image.data[index + 3] = 255;
  }
  return PNG.sync.write(image);
}

const RED = png([255, 0, 0]);
const GREEN = png([0, 255, 0]);

function capture(
  screenshot: Buffer,
  environment?: CaptureEnvironment,
  viewport = VIEWPORT,
): RenderedSnapshot {
  return {
    story: { id: "a", title: "Button", name: "Primary", type: "story" },
    viewportName: viewport.name,
    viewport,
    screenshot,
    ...(environment ? { environment } : {}),
  };
}

/** One shared database and storage across runs, so a later build sees the earlier baseline. */
function world() {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  let count = 0;
  const run = async (options: {
    shot: Buffer;
    environment?: CaptureEnvironment;
    isDefault: boolean;
    branch?: string;
    viewport?: typeof VIEWPORT;
  }): Promise<CaptureContext> => {
    count += 1;
    const build = {
      id: `b${count}`,
      projectId: "p1",
      gitSha: `sha-${count}`,
      gitBranch: options.branch ?? (options.isDefault ? "main" : "feature/x"),
      isDefault: options.isDefault,
      status: "capturing",
      createdAt: STAMP,
      updatedAt: STAMP,
    } as Build;
    await db.insert(db.tables.builds, build);
    const ctx: CaptureContext = {
      db,
      tables: {
        builds: db.tables.builds,
        buildLabels: db.tables.buildLabels,
        snapshots: db.tables.snapshots,
        baselines: db.tables.baselines,
      },
      storage,
      project,
      build,
      viewports: [VIEWPORT],
      captures: [capture(options.shot, options.environment, options.viewport)],
    };
    await persistCapture(ctx);
    return ctx;
  };
  const snapshotOf = async (buildId: string) =>
    (await db.list(db.tables.snapshots)).find((row) => row.buildId === buildId);
  const baselines = async () => (await db.list(db.tables.baselines)) as unknown as Baseline[];
  return { db, storage, objects, run, snapshotOf, baselines };
}

describe("capture environment migration", () => {
  it("records the fingerprint on the baseline of a default-branch capture", async () => {
    const { run, baselines, snapshotOf } = world();
    await run({ shot: RED, environment: ENV_A, isDefault: true });
    const [baseline] = await baselines();
    expect(baseline?.fingerprint).toBeTruthy();
    expect(JSON.parse(baseline?.fingerprint ?? "{}")).toMatchObject({
      engine: "chromium",
      browserVersion: "124.0.1",
    });
    expect((await snapshotOf("b1"))?.infraHash).toBe(baseline?.infraHash);
  });

  it("accepts a changed environment without diffing and rewrites the default baseline", async () => {
    const { run, baselines, snapshotOf, objects } = world();
    await run({ shot: RED, environment: ENV_A, isDefault: true });
    const before = (await baselines())[0];

    // Different pixels AND a different browser build: it is a migration, not a regression.
    await run({ shot: GREEN, environment: ENV_B, isDefault: true });
    const snapshot = await snapshotOf("b2");

    expect(snapshot).toMatchObject({
      status: "unchanged",
      diffPassed: true,
      diffPixels: 0,
      diffRatio: 0,
      diffPath: null,
    });
    const change = JSON.parse(snapshot?.envChange ?? "null") as EnvironmentChange;
    expect(change.changed).toEqual(["browserVersion"]);
    expect(change.from?.browserVersion).toBe("124.0.1");
    expect(change.to.browserVersion).toBe("126.0.0");

    const after = (await baselines())[0];
    expect(after?.infraHash).not.toBe(before?.infraHash);
    expect(JSON.parse(after?.fingerprint ?? "{}").browserVersion).toBe("126.0.0");
    expect(objects.get(after?.screenshotPath ?? "")?.equals(GREEN)).toBe(true);
  });

  it("still diffs a feature-branch snapshot under a changed environment", async () => {
    const { run, baselines, snapshotOf } = world();
    await run({ shot: RED, environment: ENV_A, isDefault: true });
    const before = (await baselines())[0];

    // A real change must not be auto-accepted just because main has not re-rendered yet.
    await run({ shot: GREEN, environment: ENV_B, isDefault: false });
    const snapshot = await snapshotOf("b2");

    expect(snapshot?.status).toBe("changed");
    expect(snapshot?.diffPixels).toBeGreaterThan(0);
    const change = JSON.parse(snapshot?.envChange ?? "null") as EnvironmentChange;
    expect(change.changed).toEqual(["browserVersion"]);
    const after = await baselines();
    expect(after).toHaveLength(1);
    expect(after[0]?.updatedAt).toBe(before?.updatedAt);
    expect(after[0]?.infraHash).toBe(before?.infraHash);
  });

  it("passes an identical feature-branch snapshot under a changed environment", async () => {
    const { run, snapshotOf } = world();
    await run({ shot: RED, environment: ENV_A, isDefault: true });
    await run({ shot: RED, environment: ENV_B, isDefault: false });
    const snapshot = await snapshotOf("b2");
    expect(snapshot?.status).toBe("unchanged");
    expect(snapshot?.envChange).toBeTruthy();
  });

  it("diffs a capture with no environment instead of migrating, and keeps the fingerprint", async () => {
    const { run, baselines, snapshotOf } = world();
    await run({ shot: RED, environment: ENV_A, isDefault: true });

    // Spooled before a browser crash: no environment reported.
    await run({ shot: GREEN, isDefault: false });
    expect(await snapshotOf("b2")).toMatchObject({ status: "changed", envChange: null });

    await run({ shot: GREEN, isDefault: true });
    expect(await snapshotOf("b3")).toMatchObject({ status: "approved", envChange: null });
    const [baseline] = await baselines();
    expect(JSON.parse(baseline?.fingerprint ?? "{}")).toMatchObject({
      browserVersion: "124.0.1",
      platform: "linux-x64",
      fontsHash: "fonts-a",
    });

    // The next healthy build is not a migration either: it diffs.
    await run({ shot: RED, environment: ENV_A, isDefault: false });
    expect(await snapshotOf("b4")).toMatchObject({ status: "changed", envChange: null });
  });

  it("fills a baseline's unknown components once a capture reports them", async () => {
    const { run, baselines } = world();
    await run({ shot: RED, isDefault: true });
    await run({ shot: RED, environment: ENV_A, isDefault: true });
    const [baseline] = await baselines();
    expect(JSON.parse(baseline?.fingerprint ?? "{}").browserVersion).toBe("124.0.1");
  });

  it("diffs a viewport size change from story code instead of migrating", async () => {
    const { run, snapshotOf } = world();
    await run({ shot: RED, environment: ENV_A, isDefault: true });
    await run({
      shot: png([255, 0, 0], 6),
      environment: ENV_A,
      isDefault: false,
      viewport: { ...VIEWPORT, width: 1440 },
    });
    const snapshot = await snapshotOf("b2");
    expect(snapshot).toMatchObject({ status: "changed", envChange: null, diffPassed: false });
  });

  it("still diffs when the environment is unchanged", async () => {
    const { run, snapshotOf } = world();
    await run({ shot: RED, environment: ENV_A, isDefault: true });
    await run({ shot: GREEN, environment: ENV_A, isDefault: false });
    const snapshot = await snapshotOf("b2");
    expect(snapshot?.status).toBe("changed");
    expect(snapshot?.envChange).toBeNull();
    expect(snapshot?.diffPixels).toBeGreaterThan(0);
  });

  it("names every component that changed", async () => {
    const { run, snapshotOf } = world();
    await run({ shot: RED, environment: ENV_A, isDefault: true });
    await run({
      shot: RED,
      environment: { ...ENV_B, platform: "darwin-arm64", fontsHash: "fonts-b" },
      isDefault: false,
    });
    const change = JSON.parse((await snapshotOf("b2"))?.envChange ?? "null") as EnvironmentChange;
    expect(change.changed).toEqual(["browserVersion", "platform", "fontsHash"]);
  });

  it("does not treat a baseline from before fingerprints as a migration, and backfills it", async () => {
    const { db, run, baselines, snapshotOf } = world();
    // A baseline as an older version wrote it: an infra hash but no fingerprint.
    await run({ shot: RED, environment: ENV_A, isDefault: true });
    const [seeded] = await baselines();
    await db.update(db.tables.baselines, seeded?.id ?? "", {
      infraHash: "legacy-hash",
      fingerprint: null,
    });

    await run({ shot: RED, environment: ENV_B, isDefault: true });
    const snapshot = await snapshotOf("b2");
    expect(snapshot?.envChange).toBeNull();
    expect(snapshot?.status).toBe("unchanged");
    const [after] = await baselines();
    expect(after?.fingerprint).toBeTruthy();
    expect(after?.infraHash).not.toBe("legacy-hash");

    // The next environment change is now detected.
    await run({ shot: GREEN, environment: ENV_A, isDefault: false });
    expect((await snapshotOf("b3"))?.envChange).toBeTruthy();
  });

  it("is stable for runners that report no environment", async () => {
    const { run, snapshotOf } = world();
    await run({ shot: RED, isDefault: true });
    await run({ shot: GREEN, isDefault: false });
    expect((await snapshotOf("b2"))?.status).toBe("changed");
    expect((await snapshotOf("b2"))?.envChange).toBeNull();
  });
});

const contentObjects = (objects: Map<string, Buffer>): string[] =>
  [...objects.keys()].filter((key) => key.startsWith("p1/content/") && key.endsWith(".png"));

describe("content-addressed screenshots", () => {
  it("stores each distinct screenshot once and points snapshots and baselines at it", async () => {
    const { run, objects, baselines, snapshotOf } = world();
    await run({ shot: RED, environment: ENV_A, isDefault: true });
    const [baseline] = await baselines();
    const snapshot = await snapshotOf("b1");
    expect(baseline?.screenshotPath).toMatch(/^p1\/content\/[0-9a-f]{64}\.png$/u);
    expect(snapshot?.screenshotPath).toBe(baseline?.screenshotPath);
    expect(contentObjects(objects)).toHaveLength(1);
  });

  it("uploads nothing and reads no image when a story is unchanged", async () => {
    const { run, storage, objects, snapshotOf } = world();
    await run({ shot: RED, environment: ENV_A, isDefault: true });
    const write = vi.spyOn(storage, "write");
    const read = vi.spyOn(storage, "read");

    await run({ shot: RED, environment: ENV_A, isDefault: false });
    const snapshot = await snapshotOf("b2");

    expect(snapshot).toMatchObject({ status: "unchanged", diffPassed: true, diffPixels: 0 });
    expect(write).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(contentObjects(objects)).toHaveLength(1);
  });

  it("keeps the old object when a baseline moves to new pixels", async () => {
    const { run, objects, baselines } = world();
    await run({ shot: RED, environment: ENV_A, isDefault: true });
    await run({ shot: GREEN, environment: ENV_A, isDefault: true });
    const [baseline] = await baselines();
    expect(objects.get(baseline?.screenshotPath ?? "")?.equals(GREEN)).toBe(true);
    // The superseded screenshot is still there for earlier builds; the sweep reclaims it later.
    expect(contentObjects(objects)).toHaveLength(2);
  });

  it("still diffs different pixels", async () => {
    const { run, snapshotOf } = world();
    await run({ shot: RED, environment: ENV_A, isDefault: true });
    await run({ shot: GREEN, environment: ENV_A, isDefault: false });
    expect((await snapshotOf("b2"))?.status).toBe("changed");
  });
});
