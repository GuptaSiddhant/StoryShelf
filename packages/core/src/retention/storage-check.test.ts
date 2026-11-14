import { describe, expect, it } from "vitest";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { makeDatabase, makeStorage } from "../test-helpers/index.ts";
import { storybookDir } from "../utils/paths.ts";
import { checkStorage } from "./storage-check.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

async function world(manifests: Record<string, string[] | string>) {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  for (const [id, held] of Object.entries(manifests)) {
    // oxlint-disable-next-line no-await-in-loop -- seeding in order keeps the list stable
    await db.insert(db.tables.builds, {
      id,
      projectId: "p1",
      gitSha: "s",
      gitBranch: "main",
      status: "approved",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    objects.set(
      `${storybookDir("p1", id)}/manifest.json`,
      Buffer.from(
        typeof held === "string"
          ? held
          : JSON.stringify(Object.fromEntries(held.map((hash, at) => [`f${at}`, hash]))),
      ),
    );
  }
  return { deps: { db: db as DatabaseAdapter, storage }, objects };
}

describe("checkStorage", () => {
  it("is clean when every referenced blob exists", async () => {
    const w = await world({ b1: [A, B] });
    w.objects.set(`content/${A}`, Buffer.from("x"));
    w.objects.set(`content/${B}`, Buffer.from("y"));
    const result = await checkStorage(w.deps);
    expect(result).toMatchObject({ buildsChecked: 1, builds: [], unreferencedBlobs: 0 });
  });

  it("reports a build whose blob was deleted, by build id and count only", async () => {
    const w = await world({ b1: [A, B] });
    w.objects.set(`content/${A}`, Buffer.from("x"));
    w.objects.set(`content/${B}`, Buffer.from("y"));
    w.objects.delete(`content/${B}`);
    const result = await checkStorage(w.deps);
    expect(result.builds).toEqual([{ buildId: "b1", missing: 1 }]);
    expect(JSON.stringify(result)).not.toContain(B);
  });

  it("counts blobs nothing references and deletes nothing", async () => {
    const w = await world({ b1: [A] });
    w.objects.set(`content/${A}`, Buffer.from("x"));
    w.objects.set(`content/${C}`, Buffer.from("z"));
    const before = new Set(w.objects.keys());
    const result = await checkStorage(w.deps);
    expect(result.unreferencedBlobs).toBe(1);
    expect(new Set(w.objects.keys())).toEqual(before);
  });

  it("flags an unreadable manifest and does not guess unreferenced blobs", async () => {
    const w = await world({ b1: "not json" });
    w.objects.set(`content/${C}`, Buffer.from("z"));
    const result = await checkStorage(w.deps);
    expect(result.unreadableManifests).toEqual(["b1"]);
    expect(result.unreferencedBlobs).toBe(0);
  });

  it("reports a baseline whose image is gone", async () => {
    const w = await world({});
    await w.deps.db.insert(w.deps.db.tables.baselines, {
      id: "bl1",
      projectId: "p1",
      storyId: "s",
      viewportName: "desktop",
      branch: "main",
      screenshotPath: "p1/baselines/main/s/desktop.png",
      createdAt: "t",
      updatedAt: "t",
    } as never);
    const result = await checkStorage(w.deps);
    expect(result).toMatchObject({ baselinesChecked: 1, missingBaselineImages: 1 });
  });

  it("samples the newest builds and skips the unreferenced count", async () => {
    const w = await world({ b1: [A], b2: [B], b3: [C] });
    const result = await checkStorage(w.deps, { sample: 2 });
    expect(result).toMatchObject({ buildsChecked: 2, sampled: true, unreferencedBlobs: 0 });
    expect(new Set(result.builds.map((entry) => entry.buildId))).toEqual(new Set(["b2", "b3"]));
  });
});
