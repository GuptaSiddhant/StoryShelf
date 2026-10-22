import { BaselineModel, BuildModel, SnapshotModel } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubRunner } from "../test-runner.ts";

const silentLogger = pino({ level: "silent" });
const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";
const BASE = "/api/v1/projects/test-project/builds/f1";

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

const build = {
  id: "f1",
  projectId: "p1",
  gitSha: "sha-f1",
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

/** Story `a` in mode `dark` on two engines, plus an unrelated open snapshot `b`. */
async function setup() {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  await db.insert(db.tables.projects, project);
  await db.insert(db.tables.builds, build);
  const seeds = [
    ["a", "chromium", "s-a-chromium"],
    ["a", "firefox", "s-a-firefox"],
    ["b", "chromium", "s-b-chromium"],
  ] as const;
  await Promise.all(
    seeds.map(async ([storyId, browser, id]) => {
      objects.set(`shots/${id}.png`, Buffer.from(id));
      await db.insert(db.tables.snapshots, {
        id,
        projectId: "p1",
        buildId: "f1",
        storyId,
        storyName: storyId.toUpperCase(),
        storyTitle: "T",
        viewportName: "dark",
        browser,
        screenshotPath: `shots/${id}.png`,
        status: "new",
        baselineId: null,
        baselineVersion: "none",
        createdAt: T1,
        updatedAt: T1,
      });
    }),
  );
  const app = createShelfApp({
    testing: { runner: stubRunner() },
    database: db,
    storage,
    logger: silentLogger,
  });
  return { app, db };
}

async function post(app: ReturnType<typeof createShelfApp>, path: string) {
  return await app.request(`${BASE}/${path}`, { method: "POST" });
}

async function statuses(db: Awaited<ReturnType<typeof setup>>["db"]) {
  const rows = await new SnapshotModel(db).listByBuild("f1");
  return Object.fromEntries(rows.map((row) => [row.id, row.status]));
}

describe("group approve/reject across browsers", () => {
  it("approves every engine of a story/mode and promotes per-engine baselines", async () => {
    const { app, db } = await setup();

    const response = await post(app, "stories/a/modes/dark/approve");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      snapshotIds: expect.arrayContaining(["s-a-chromium", "s-a-firefox"]),
    });
    expect(await statuses(db)).toEqual({
      "s-a-chromium": "approved",
      "s-a-firefox": "approved",
      "s-b-chromium": "new",
    });
    const baselines = new BaselineModel(db);
    expect(await baselines.getFor("p1", "a", "dark", "feature/x", "chromium")).not.toBeNull();
    expect(await baselines.getFor("p1", "a", "dark", "feature/x", "firefox")).not.toBeNull();
    expect(await baselines.getFor("p1", "b", "dark", "feature/x", "chromium")).toBeNull();
  });

  it("refuses the whole group with 409 when any engine's baseline drifted", async () => {
    const { app, db } = await setup();
    await db.insert(db.tables.baselines, {
      id: "bl-ff",
      projectId: "p1",
      storyId: "a",
      viewportName: "dark",
      browser: "firefox",
      branch: "main",
      snapshotId: "s0",
      screenshotPath: "baselines/ff.png",
      createdAt: T1,
      updatedAt: T2,
    });
    await db.update(db.tables.snapshots, "s-a-firefox", {
      status: "changed",
      baselineId: "bl-ff",
      baselineVersion: T1,
    });

    const response = await post(app, "stories/a/modes/dark/approve");

    expect(response.status).toBe(409);
    expect(await statuses(db)).toMatchObject({
      "s-a-chromium": "new",
      "s-a-firefox": "changed",
    });
    expect(
      await new BaselineModel(db).getFor("p1", "a", "dark", "feature/x", "chromium"),
    ).toBeNull();

    const forced = await post(app, "stories/a/modes/dark/approve?force=true");
    expect(forced.status).toBe(200);
    expect(await statuses(db)).toMatchObject({
      "s-a-chromium": "approved",
      "s-a-firefox": "approved",
    });
  });

  it("rejects every engine of a story/mode and refreshes the build", async () => {
    const { app, db } = await setup();

    const response = await post(app, "stories/a/modes/dark/reject");

    expect(response.status).toBe(200);
    expect(await statuses(db)).toEqual({
      "s-a-chromium": "rejected",
      "s-a-firefox": "rejected",
      "s-b-chromium": "new",
    });
    expect((await new BuildModel(db).get("f1"))?.status).toBe("reviewing");
  });

  it("404s when the group has nothing open", async () => {
    const { app } = await setup();
    expect((await post(app, "stories/a/modes/light/approve")).status).toBe(404);
    expect((await post(app, "stories/zzz/modes/dark/reject")).status).toBe(404);
  });

  it("approve-all skips a whole group when one engine drifted", async () => {
    const { app, db } = await setup();
    await db.insert(db.tables.baselines, {
      id: "bl-ff",
      projectId: "p1",
      storyId: "a",
      viewportName: "dark",
      browser: "firefox",
      branch: "main",
      snapshotId: "s0",
      screenshotPath: "baselines/ff.png",
      createdAt: T1,
      updatedAt: T2,
    });
    await db.update(db.tables.snapshots, "s-a-firefox", {
      status: "changed",
      baselineId: "bl-ff",
      baselineVersion: T1,
    });

    const response = await post(app, "approve-all");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { skipped: string[] };
    expect(body.skipped).toEqual(expect.arrayContaining(["s-a-chromium", "s-a-firefox"]));
    expect(await statuses(db)).toEqual({
      "s-a-chromium": "new",
      "s-a-firefox": "changed",
      "s-b-chromium": "approved",
    });
  });
});
