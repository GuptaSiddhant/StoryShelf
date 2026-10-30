import { describe, expect, it, vi } from "vitest";
import type { BuildReferenceLifecycle } from "../adapters/database.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { upsertAtomicBaseline, type AtomicBaselineInput } from "./baseline-atomic.ts";

const input: AtomicBaselineInput = {
  id: "baseline",
  existingId: null,
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
    replaceReferences: async (_owner, _ids, writeDomain) => await writeDomain(db),
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
});
