import { describe, expect, it, vi } from "vitest";
import type { BuildReferenceLifecycle } from "../adapters/database.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import {
  nextBaselineVersion,
  upsertAtomicBaseline,
  type AtomicBaselineInput,
} from "./baseline-atomic.ts";

const input: AtomicBaselineInput = {
  id: "baseline",
  existingId: null,
  existingVersion: null,
  projectId: "p",
  storyId: "story",
  viewport: "desktop",
  branch: "main",
  browser: "chromium",
  snapshotId: "snap",
  sourceBuildId: "source",
  originalPath: "original",
  screenshotPath: "content",
  infraHash: null,
  fingerprint: null,
  mode: null,
};
function setup() {
  const { db } = makeDatabase();
  const lifecycle: BuildReferenceLifecycle = {
    referenceGeneration: async () => await Promise.resolve(0),
    replaceManyFencedReferences: async (changes, writeDomain) => ({
      result: await writeDomain(db),
      generations: changes.map((change) => change.expectedGeneration + 1),
    }),
    replaceFencedReferences: async (_owner, generation, _ids, writeDomain) => ({
      result: await writeDomain(db),
      generation: generation + 1,
    }),
    replaceReferences: async (_owner, _ids, writeDomain) => await writeDomain(db),
    replaceManyReferences: async (_changes, writeDomain) => await writeDomain(db),
    claimDeletion: async () => "missing",
  };
  const tables = { baselines: db.tables.baselines, snapshots: db.tables.snapshots };
  return { db, lifecycle, tables };
}
async function insertSource(db: ReturnType<typeof setup>["db"]): Promise<void> {
  await db.insert(db.tables.snapshots, {
    id: "snap",
    projectId: "p",
    storyId: "story",
    viewportName: "desktop",
    browser: "chromium",
    screenshotPath: "original",
    inherited: false,
    buildId: "source",
  });
}

describe("atomic baseline promotion", () => {
  it("advances the baseline version for updates in the same millisecond or after clock rollback", () => {
    const previous = "2026-01-01T00:00:00.000Z";
    expect(nextBaselineVersion(previous, new Date(previous))).toBe("2026-01-01T00:00:00.001Z");
    expect(nextBaselineVersion(previous, new Date("2025-01-01T00:00:00.000Z"))).toBe(
      "2026-01-01T00:00:00.001Z",
    );
    expect(nextBaselineVersion(null, new Date(previous))).toBe(previous);
  });
  it("admits the source build and writes its baseline inside the lifecycle callback", async () => {
    const { db, lifecycle, tables } = setup();
    await insertSource(db);
    const admission = vi.spyOn(lifecycle, "replaceReferences");
    const baseline = await upsertAtomicBaseline(lifecycle, tables, input);
    expect(baseline.sourceBuildId).toBe("source");
    expect(admission).toHaveBeenCalledWith(
      { projectId: "p", type: "baseline", id: "baseline" },
      ["source"],
      expect.any(Function),
    );
  });
  it("rejects a source snapshot that changed after the initial lookup", async () => {
    const { db, lifecycle, tables } = setup();
    await insertSource(db);
    await db.update(db.tables.snapshots, "snap", { screenshotPath: "different" });
    await expect(upsertAtomicBaseline(lifecycle, tables, input)).rejects.toThrow(
      "Source snapshot changed",
    );
    expect(await db.get(db.tables.baselines, "baseline")).toBeNull();
  });
  it("rejects a concurrently created baseline identity", async () => {
    const { db, lifecycle, tables } = setup();
    await insertSource(db);
    await db.insert(db.tables.baselines, {
      id: "other",
      projectId: "p",
      storyId: "story",
      viewportName: "desktop",
      branch: "main",
      browser: "chromium",
    });
    await expect(upsertAtomicBaseline(lifecycle, tables, input)).rejects.toThrow(
      "Baseline changed",
    );
  });
  it("rejects a concurrent update to the same baseline identity", async () => {
    const { db, lifecycle, tables } = setup();
    await insertSource(db);
    await db.insert(db.tables.baselines, {
      id: "baseline",
      projectId: "p",
      storyId: "story",
      viewportName: "desktop",
      branch: "main",
      browser: "chromium",
      updatedAt: "new-version",
    });
    await expect(
      upsertAtomicBaseline(lifecycle, tables, {
        ...input,
        existingId: "baseline",
        existingVersion: "old-version",
      }),
    ).rejects.toThrow("Baseline changed");
    expect((await db.get(db.tables.baselines, "baseline"))?.["updatedAt"]).toBe("new-version");
  });
});
