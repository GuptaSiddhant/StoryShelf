import type { Snapshot } from "@storyshelf/core/schema";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { readComparisonImage, validFrozenReference } from "./comparison-image.ts";

const read = vi.fn();
vi.mock("../store.ts", () => ({ getStore: () => ({ storage: { read } }) }));

const path = "p/builds/b/comparisons/01ARZ3NDEKTSV4RRFFQ69G5FAV.png";
const metadata = {
  version: 1,
  baselineId: "base",
  baselineVersion: "v1",
  branch: "main",
  defaultBranch: true,
  sourceBuildId: null,
  sourceSnapshotId: null,
  imageSha256: "a".repeat(64),
  baselineFingerprint: null,
  captureFingerprint: null,
  mode: null,
  target: "chromium",
  width: 800,
  height: 600,
};
const snapshot = {
  comparisonImagePath: path,
  comparisonMetadata: JSON.stringify(metadata),
  baselineId: "base",
  baselineVersion: "v1",
} as Snapshot;

describe("frozen comparison validation", () => {
  it("accepts only matching metadata and a path owned by the consuming build", () => {
    expect(validFrozenReference(snapshot, "p", "b")?.path).toBe(path);
    expect(validFrozenReference(snapshot, "other", "b")).toBeNull();
    expect(validFrozenReference(snapshot, "p", "other")).toBeNull();
    expect(
      validFrozenReference({ ...snapshot, comparisonMetadata: "broken" }, "p", "b"),
    ).toBeNull();
    expect(
      validFrozenReference(
        { ...snapshot, comparisonMetadata: JSON.stringify({ ...metadata, version: 2 }) },
        "p",
        "b",
      ),
    ).toBeNull();
    expect(validFrozenReference({ ...snapshot, baselineId: "other" }, "p", "b")).toBeNull();
    expect(validFrozenReference({ ...snapshot, baselineVersion: "other" }, "p", "b")).toBeNull();
    expect(validFrozenReference({ ...snapshot, comparisonImagePath: null }, "p", "b")).toBeNull();
  });
  it("returns bytes only when the image exists and its digest matches", async () => {
    const image = Buffer.from("original");
    const digest = createHash("sha256").update(image).digest("hex");
    read
      .mockResolvedValueOnce(image)
      .mockResolvedValueOnce(image)
      .mockRejectedValueOnce(new Error("missing"));
    expect(await readComparisonImage(path, digest)).toEqual(image);
    expect(await readComparisonImage(path, "a".repeat(64))).toBeNull();
    expect(await readComparisonImage(path, digest)).toBeNull();
  });
});
