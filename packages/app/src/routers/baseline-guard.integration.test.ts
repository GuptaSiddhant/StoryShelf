import { BaselineModel, SnapshotModel } from "@storyshelf/core/models";
import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { crc32, deflateSync } from "node:zlib";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";

const silentLogger = pino({ level: "silent" });
const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";
const BASE = "/api/v1/projects/test-project/builds";

const project: Project = {
  id: "p1",
  name: "Test Project",
  slug: "test-project",
  gitRepository: "owner/repo",
  gitDefaultBranch: "main",
  pixelThreshold: 0.1,
  maxDiffRatio: 0.01,
  publicBranchRegex: null,
  executePlay: false,
  playTimeoutMs: 10_000,
  storybookMeta: null,
  createdAt: T1,
  updatedAt: T1,
};

function featureBuild(id: string): Build {
  return {
    id,
    projectId: "p1",
    gitSha: `sha-${id}`,
    gitBranch: "feature/x",
    isDefault: false,
    authorEmail: null,
    authorName: null,
    message: null,
    public: false,
    status: "reviewing",
    snapshotCount: 0,
    changedCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    affectedOnly: true,
    baselineSha: null,
    changedFiles: null,
    affectedImportPaths: null,
    createdAt: T1,
    updatedAt: T1,
  } as Build;
}

type Tracking = Pick<Snapshot, "baselineId" | "baselineVersion">;
const CURRENT_TRACKING: Tracking = { baselineId: "bl-main", baselineVersion: T1 };

async function setup(snapshotTracking: Tracking = CURRENT_TRACKING) {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  await db.insert(db.tables.projects, project);
  await db.insert(db.tables.builds, featureBuild("f1"));
  await db.insert(db.tables.baselines, {
    id: "bl-main",
    projectId: "p1",
    storyId: "a",
    viewportName: "desktop",
    branch: "main",
    snapshotId: "s0",
    screenshotPath: "baselines/main/a.png",
    createdAt: T1,
    updatedAt: T1,
  });
  objects.set("baselines/main/a.png", Buffer.from("main-v1"));
  objects.set("shots/f1/a.png", Buffer.from("feature"));
  await db.insert(db.tables.snapshots, {
    id: "sf1",
    projectId: "p1",
    buildId: "f1",
    storyId: "a",
    storyName: "A",
    storyTitle: "T",
    viewportName: "desktop",
    screenshotPath: "shots/f1/a.png",
    status: "changed",
    createdAt: T1,
    updatedAt: T1,
    ...snapshotTracking,
  });
  const app = createShelfApp({ database: db, storage, logger: silentLogger });
  return { app, db, objects };
}

async function post(app: ReturnType<typeof createShelfApp>, path: string, htmx = false) {
  return await app.request(`${BASE}/${path}`, {
    method: "POST",
    headers: htmx ? { "hx-request": "true" } : {},
  });
}

async function moveMainBaseline(db: Awaited<ReturnType<typeof setup>>["db"]) {
  await db.update(db.tables.baselines, "bl-main", { updatedAt: T2 });
}

describe("approval guard for changed baselines", () => {
  it("approves and writes the branch baseline when the baseline is unchanged", async () => {
    const { app, db } = await setup();

    const response = await post(app, "f1/snapshots/sf1/approve");

    expect(response.status).toBe(200);
    expect((await new SnapshotModel(db).get("sf1"))?.status).toBe("approved");
    expect(await new BaselineModel(db).getFor("p1", "a", "desktop", "feature/x")).not.toBeNull();
  });

  it("refuses with 409 when the baseline changed after the diff", async () => {
    const { app, db } = await setup();
    await moveMainBaseline(db);

    const response = await post(app, "f1/snapshots/sf1/approve");

    expect(response.status).toBe(409);
    const body = (await response.json()) as { code: string; snapshotId: string };
    expect(body.code).toBe("baseline_changed");
    expect(body.snapshotId).toBe("sf1");
    expect((await new SnapshotModel(db).get("sf1"))?.status).toBe("changed");
    expect(await new BaselineModel(db).getFor("p1", "a", "desktop", "feature/x")).toBeNull();
  });

  it("approves a stale snapshot when forced", async () => {
    const { app, db } = await setup();
    await moveMainBaseline(db);

    const response = await post(app, "f1/snapshots/sf1/approve?force=true");

    expect(response.status).toBe(200);
    expect((await new SnapshotModel(db).get("sf1"))?.status).toBe("approved");
  });

  it("treats legacy snapshots without tracking as approvable", async () => {
    const { app, db } = await setup({ baselineId: null, baselineVersion: null });
    await moveMainBaseline(db);

    const response = await post(app, "f1/snapshots/sf1/approve");

    expect(response.status).toBe(200);
  });

  it("refuses when the recorded baseline was removed", async () => {
    const { app, db } = await setup();
    await db.remove(db.tables.baselines, "bl-main");

    expect((await post(app, "f1/snapshots/sf1/approve")).status).toBe(409);
  });

  it("lets only the first of two builds on a branch approve the same story", async () => {
    const { app, db } = await setup();
    await db.insert(db.tables.builds, featureBuild("f2"));
    await db.insert(db.tables.snapshots, {
      id: "sf2",
      projectId: "p1",
      buildId: "f2",
      storyId: "a",
      storyName: "A",
      storyTitle: "T",
      viewportName: "desktop",
      screenshotPath: "shots/f1/a.png",
      status: "changed",
      baselineId: "bl-main",
      baselineVersion: T1,
      createdAt: T1,
      updatedAt: T1,
    });

    expect((await post(app, "f1/snapshots/sf1/approve")).status).toBe(200);
    expect((await post(app, "f2/snapshots/sf2/approve")).status).toBe(409);
  });

  it("answers htmx with a refresh on success and a redirect to the review page on conflict", async () => {
    const stale = await setup();
    await moveMainBaseline(stale.db);
    const conflict = await post(stale.app, "f1/snapshots/sf1/approve", true);
    expect(conflict.status).toBe(200);
    expect(conflict.headers.get("hx-redirect")).toBe(
      "/projects/test-project/builds/f1/diff?snapshot=sf1",
    );

    const fresh = await setup();
    const ok = await post(fresh.app, "f1/snapshots/sf1/approve", true);
    expect(ok.headers.get("hx-refresh")).toBe("true");
  });

  it("approve-all skips snapshots with a changed baseline and reports them", async () => {
    const { app, db } = await setup();
    await db.insert(db.tables.snapshots, {
      id: "sf-b",
      projectId: "p1",
      buildId: "f1",
      storyId: "b",
      storyName: "B",
      storyTitle: "T",
      viewportName: "desktop",
      screenshotPath: "shots/f1/a.png",
      status: "new",
      baselineId: null,
      baselineVersion: "none",
      createdAt: T1,
      updatedAt: T1,
    });
    await moveMainBaseline(db);

    const response = await post(app, "f1/approve-all");

    expect(await response.json()).toEqual({ ok: true, skipped: ["sf1"] });
    expect((await new SnapshotModel(db).get("sf1"))?.status).toBe("changed");
    expect((await new SnapshotModel(db).get("sf-b"))?.status).toBe("approved");
  });

  it("approve-all with force approves everything", async () => {
    const { app, db } = await setup();
    await moveMainBaseline(db);

    const response = await post(app, "f1/approve-all?force=true");

    expect(await response.json()).toEqual({ ok: true, skipped: [] });
    expect((await new SnapshotModel(db).get("sf1"))?.status).toBe("approved");
  });

  it("sets HX-Refresh on htmx reject", async () => {
    const { app } = await setup();
    const response = await post(app, "f1/snapshots/sf1/reject", true);
    expect(response.headers.get("hx-refresh")).toBe("true");
  });
});

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

/** A 4x4 solid-colour RGB PNG. */
function solidPng(rgb: [number, number, number]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(4, 0);
  header.writeUInt32BE(4, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: 4 }, () => rgb).flat()),
  ]);
  const raw = Buffer.concat(Array.from({ length: 4 }, () => row));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const GREEN: [number, number, number] = [0, 255, 0];
const BLUE: [number, number, number] = [0, 0, 255];

async function pngSetup() {
  const ctx = await setup();
  ctx.objects.set("baselines/main/a.png", solidPng(GREEN));
  ctx.objects.set("shots/f1/a.png", solidPng(GREEN));
  return ctx;
}

describe("re-diff after a baseline change", () => {
  it("clears a stale change once the baseline matches the screenshot, then rolls up the build", async () => {
    const { app, db } = await pngSetup();
    await moveMainBaseline(db);

    const response = await post(app, "f1/rediff");

    expect(await response.json()).toEqual({
      ok: true,
      rediffed: 1,
      statusChanged: 1,
      missingScreenshots: [],
    });
    expect((await new SnapshotModel(db).get("sf1"))?.status).toBe("unchanged");
    expect((await db.get(db.tables.builds, "f1"))?.["status"]).toBe("approved");
  });

  it("lets the reviewer approve again after re-diffing against the new baseline", async () => {
    const { app, db, objects } = await pngSetup();
    objects.set("baselines/main/a.png", solidPng(BLUE));
    await moveMainBaseline(db);
    expect((await post(app, "f1/snapshots/sf1/approve")).status).toBe(409);

    await post(app, "f1/rediff");

    expect((await new SnapshotModel(db).get("sf1"))?.status).toBe("changed");
    expect((await post(app, "f1/snapshots/sf1/approve")).status).toBe(200);
  });

  it("refuses default-branch builds and builds that have not finished capturing", async () => {
    const { app, db } = await pngSetup();
    await db.insert(db.tables.builds, {
      ...featureBuild("m1"),
      gitBranch: "main",
      isDefault: true,
    });
    await db.insert(db.tables.builds, { ...featureBuild("c1"), status: "failed" });

    expect((await post(app, "m1/rediff")).status).toBe(400);
    expect((await post(app, "c1/rediff")).status).toBe(409);
  });

  it("refreshes the page for htmx callers", async () => {
    const { app } = await pngSetup();
    const response = await post(app, "f1/rediff", true);
    expect(response.headers.get("hx-refresh")).toBe("true");
  });
});

async function page(app: ReturnType<typeof createShelfApp>, path: string): Promise<string> {
  const response = await app.request(path);
  expect(response.status).toBe(200);
  return await response.text();
}

const REVIEW = "/projects/test-project/builds/f1/diff?snapshot=sf1";

describe("review pages for changed baselines", () => {
  it("explains the stale diff, states recapture is manual, and offers re-diff and retry", async () => {
    const { app, db } = await setup();
    await moveMainBaseline(db);

    const body = await page(app, REVIEW);

    expect(body).toContain("Baseline changed since this build was captured");
    expect(body).toContain("Builds are not recaptured automatically");
    expect(body).toContain(`${BASE}/f1/rediff`);
    expect(body).toContain(`${BASE}/f1/retry`);
    expect(body).toContain("This diff is out of date");
  });

  it("swaps Approve for Approve anyway on a stale snapshot, without the keyboard shortcut", async () => {
    const { app, db } = await setup();
    await moveMainBaseline(db);

    const body = await page(app, REVIEW);

    expect(body).toContain("Approve anyway");
    expect(body).toContain(`${BASE}/f1/snapshots/sf1/approve?force=true`);
    expect(body).not.toContain(`data-approve="true"`);
  });

  it("shows the plain Approve and no notice when the baseline is current", async () => {
    const { app } = await setup();

    const body = await page(app, REVIEW);

    expect(body).not.toContain("Baseline changed since this build was captured");
    expect(body).not.toContain("Approve anyway");
    expect(body).toContain(`data-approve="true"`);
  });

  it("shows no notice for legacy snapshots without baseline tracking", async () => {
    const { app, db } = await setup({ baselineId: null, baselineVersion: null });
    await moveMainBaseline(db);

    expect(await page(app, REVIEW)).not.toContain("Baseline changed since this build");
  });

  it("clears the notice once the build is re-diffed", async () => {
    const { app, db, objects } = await setup();
    objects.set("baselines/main/a.png", solidPng(GREEN));
    objects.set("shots/f1/a.png", solidPng(GREEN));
    await moveMainBaseline(db);
    await post(app, "f1/rediff");

    expect(await page(app, REVIEW)).not.toContain("Baseline changed since this build");
  });

  it("surfaces the same notice on the build overview", async () => {
    const { app, db } = await setup();
    await moveMainBaseline(db);

    const body = await page(app, "/projects/test-project/builds/f1");

    expect(body).toContain("Baseline changed since this build was captured");
    expect(body).toContain("Re-diff against current baselines");
  });

  it("never shows the notice on a default-branch build", async () => {
    const { app, db } = await setup();
    await db.update(db.tables.builds, "f1", { gitBranch: "main", isDefault: true });
    await moveMainBaseline(db);

    expect(await page(app, REVIEW)).not.toContain("Baseline changed since this build");
  });
});
