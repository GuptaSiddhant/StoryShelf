import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Baseline } from "../schema/baseline.ts";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import {
  freezeComparison,
  parseComparisonReference,
  sourceSnapshotId,
} from "./comparison-reference.ts";

const baseline = {
  id: "baseline",
  projectId: "p",
  branch: "main",
  updatedAt: "v1",
  screenshotPath: "baseline.png",
  sourceBuildId: "source",
  fingerprint: null,
} as Baseline;
const settings = {
  defaultBranch: "main",
  mode: null,
  target: "chromium",
  width: 800,
  height: 600,
  captureFingerprint: null,
  sourceSnapshotId: null,
};
describe("frozen comparison reference", () => {
  it("retains the original image and provenance when the baseline changes", async () => {
    const { storage } = makeStorage();
    const original = Buffer.from("original image");
    await storage.write("baseline.png", original);
    const saved = await freezeComparison(storage, "p", "build", baseline, settings);
    await storage.write("baseline.png", Buffer.from("changed"));
    expect(saved.comparisonImagePath).toMatch(/^p\/builds\/build\/comparisons\//u);
    expect(await storage.read(saved.comparisonImagePath)).toEqual(original);
    expect(parseComparisonReference(saved.comparisonMetadata)).toMatchObject({
      baselineId: "baseline",
      baselineVersion: "v1",
      sourceBuildId: "source",
      imageSha256: createHash("sha256").update(original).digest("hex"),
    });
  });
  it("records a source snapshot only if it actually rendered this baseline image", async () => {
    const { db } = makeDatabase();
    const row = {
      id: "snap",
      projectId: "p",
      buildId: "source",
      storyId: "story",
      viewportName: "desktop",
      browser: "chromium",
      screenshotPath: "baseline.png",
      inherited: false,
    };
    await db.insert(db.tables.snapshots, row);
    const reference = {
      ...baseline,
      snapshotId: "snap",
      storyId: "story",
      viewportName: "desktop",
      browser: "chromium",
    };
    expect(await sourceSnapshotId(db, reference)).toBe("snap");
    await db.update(db.tables.snapshots, "snap", { inherited: true });
    expect(await sourceSnapshotId(db, reference)).toBeNull();
    await db.update(db.tables.snapshots, "snap", { inherited: false, screenshotPath: "different" });
    expect(await sourceSnapshotId(db, reference)).toBeNull();
  });
  it("rejects malformed or unsupported metadata", () => {
    expect(parseComparisonReference(null)).toBeNull();
    expect(parseComparisonReference("broken")).toBeNull();
    expect(parseComparisonReference('{"version":2}')).toBeNull();
  });
});
