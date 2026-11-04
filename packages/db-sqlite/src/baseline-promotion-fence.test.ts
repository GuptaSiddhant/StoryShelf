import { createShelfLogger } from "@storyshelf/core/logger";
import { BaselineModel, BaselinePromotionRefused, BuildModel } from "@storyshelf/core/models";
import { makeStorage } from "@storyshelf/core/test-helpers";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBuildReferenceLifecycle } from "./build-reference-lifecycle.ts";
import { createSqliteDatabase } from "./index.ts";
import { schema } from "./schema/index.ts";

/**
 * A cancel lands on one connection while a capture promotes baselines on another: the promotion is
 * fenced on the build, with the reference lifecycle (inside its write transaction) and without it.
 */
const NOW = "2026-01-01T00:00:00.000Z";
const SHOT = Buffer.from([137, 80, 78, 71]);

let dir = "";
let path = "";
const opened: ReturnType<typeof createSqliteDatabase>[] = [];

/** A fresh connection to the shared file; `lifecycle` also wires the reference lifecycle. */
async function connect(options: { lifecycle: boolean }) {
  const db = createSqliteDatabase(path);
  opened.push(db);
  await db.lifecycle?.setup({ config: {}, logger: createShelfLogger({ level: "silent" }) });
  if (options.lifecycle) {
    Object.assign(db, { buildReferenceLifecycle: createBuildReferenceLifecycle(path) });
  }
  return db;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-promotion-fence-"));
  path = join(dir, "test.sqlite");
  const seed = await connect({ lifecycle: false });
  await seed.insert(schema.projects, {
    id: "p",
    name: "Project",
    slug: "p",
    createdAt: NOW,
    updatedAt: NOW,
  });
  await seed.insert(schema.builds, {
    id: "b1",
    projectId: "p",
    gitSha: "sha1",
    gitBranch: "main",
    isDefault: true,
    status: "capturing",
    captureGeneration: 3,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await seed.insert(schema.snapshots, {
    id: "s1",
    projectId: "p",
    buildId: "b1",
    storyId: "button--primary",
    storyName: "primary",
    storyTitle: "Button",
    storyImportPath: "./Button.stories.tsx",
    screenshotPath: "shots/s1.png",
    status: "unchanged",
    viewportName: "desktop",
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
});

afterEach(async () => {
  await Promise.allSettled(opened.splice(0).map(async (db) => await db.lifecycle?.teardown()));
  rmSync(dir, { recursive: true, force: true });
});

async function promote(
  db: Awaited<ReturnType<typeof connect>>,
  capturingBuild: { id: string; generation?: number },
) {
  const { storage } = makeStorage();
  await storage.write("shots/s1.png", SHOT);
  return await new BaselineModel(db, db.tables, storage).upsert(
    "p",
    "button--primary",
    "desktop",
    "main",
    "s1",
    "shots/s1.png",
    null,
    { capturingBuild },
  );
}

const baselineRows = async (db: Awaited<ReturnType<typeof connect>>) =>
  await db.list(schema.baselines, {});
const statusOf = async (db: Awaited<ReturnType<typeof connect>>) =>
  (await new BuildModel(db).get("b1"))?.status;

describe.each([
  ["with the reference lifecycle (checked in the write transaction)", true],
  ["without it (checked right before the write)", false],
])("a cancel on another connection, %s", (_label, lifecycle) => {
  it("promotes while the build is live", async () => {
    const capture = await connect({ lifecycle });
    await promote(capture, { id: "b1", generation: 3 });
    expect(await baselineRows(capture)).toHaveLength(1);
  });

  it("moves no baseline when the cancel landed before the promotion, and the build stays cancelled", async () => {
    const capture = await connect({ lifecycle });
    const canceller = await connect({ lifecycle: false });
    await new BuildModel(canceller).setStatus("b1", "cancelled");
    await expect(promote(capture, { id: "b1", generation: 3 })).rejects.toBeInstanceOf(
      BaselinePromotionRefused,
    );
    expect(await baselineRows(capture)).toHaveLength(0);
    expect(await statusOf(capture)).toBe("cancelled");
  });

  it("keeps the baseline, and the build cancelled, when the cancel lands after the promotion", async () => {
    const capture = await connect({ lifecycle });
    const canceller = await connect({ lifecycle: false });
    await promote(capture, { id: "b1", generation: 3 });
    await new BuildModel(canceller).setStatus("b1", "cancelled");
    // Accepted semantics: a promotion that already committed is not rolled back by a later cancel.
    expect(await baselineRows(capture)).toHaveLength(1);
    expect(await statusOf(capture)).toBe("cancelled");
  });

  it("refuses a run whose capture generation a retry has moved on", async () => {
    const capture = await connect({ lifecycle });
    await expect(promote(capture, { id: "b1", generation: 2 })).rejects.toBeInstanceOf(
      BaselinePromotionRefused,
    );
    expect(await baselineRows(capture)).toHaveLength(0);
  });

  it("refuses a build that no longer exists", async () => {
    const capture = await connect({ lifecycle });
    await expect(promote(capture, { id: "gone" })).rejects.toBeInstanceOf(BaselinePromotionRefused);
  });
});
