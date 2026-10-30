import { BaselineModel, BuildModel, SnapshotModel } from "@storyshelf/core/models";
import type { Baseline, Build, Project, Snapshot } from "@storyshelf/core/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runWithStore, type Store } from "../store.ts";
import { loadBaselineReference, loadDefaultComparison } from "./baseline-reference.ts";

const project = { id: "p", gitDefaultBranch: "main" } as Project;
const build = { gitBranch: "feature" } as Build;
const snapshot = {
  baselineId: "base",
  baselineVersion: "t1",
  storyId: "story",
  viewportName: "desktop",
} as Snapshot;
const baseline = { id: "base", updatedAt: "t1", branch: "main", snapshotId: "source" } as Baseline;
const store = { db: { tables: {} }, storage: { exists: async () => true } } as unknown as Store;
const load = async (row: Snapshot = snapshot) =>
  await runWithStore(store, async () => await loadBaselineReference(project, build, row));
afterEach(() => vi.restoreAllMocks());

describe("baseline reference", () => {
  it("reports the absence of a baseline at capture even if one exists now", async () => {
    expect(await load({ ...snapshot, baselineId: null, baselineVersion: "none" })).toEqual({
      kind: "none",
    });
  });
  it("does not infer a legacy or changed reference", async () => {
    expect(await load({ ...snapshot, baselineVersion: null })).toEqual({ kind: "unavailable" });
    vi.spyOn(BaselineModel.prototype, "resolve").mockResolvedValue({
      ...baseline,
      updatedAt: "t2",
    });
    expect(await load()).toEqual({ kind: "unavailable" });
  });
  it("shows the matching branch and originating build", async () => {
    vi.spyOn(BaselineModel.prototype, "resolve").mockResolvedValue(baseline);
    vi.spyOn(SnapshotModel.prototype, "get").mockResolvedValue({
      projectId: "p",
      buildId: "b",
      inherited: false,
    } as Snapshot);
    vi.spyOn(BuildModel.prototype, "get").mockResolvedValue({
      id: "b",
      projectId: "p",
      gitSha: "abc",
    } as Build);
    expect(await load()).toMatchObject({
      kind: "known",
      branch: "main",
      defaultBranch: true,
      build: { id: "b" },
    });
  });
  it("does not identify an inherited snapshot's build as the image source", async () => {
    vi.spyOn(BaselineModel.prototype, "resolve").mockResolvedValue({
      ...baseline,
      branch: "feature",
    });
    vi.spyOn(SnapshotModel.prototype, "get").mockResolvedValue({
      projectId: "p",
      buildId: "b",
      inherited: true,
    } as Snapshot);
    expect(await load()).toMatchObject({ kind: "known", defaultBranch: false, build: null });
  });
});

describe("current default comparison", () => {
  it("reports a different environment and keeps the default reference separate", async () => {
    vi.spyOn(BaselineModel.prototype, "getFor").mockResolvedValue({
      ...baseline,
      infraHash: "old",
    });
    const result = await runWithStore(
      store,
      async () =>
        await loadDefaultComparison(project, build, {
          ...snapshot,
          baselineId: "other",
          infraHash: "new",
        }),
    );
    expect(result).toMatchObject({ id: "base", environment: "different", available: true });
  });
  it("does not offer a redundant comparison and reports unknown environments", async () => {
    vi.spyOn(BaselineModel.prototype, "getFor").mockResolvedValue(baseline);
    expect(
      await runWithStore(store, async () => await loadDefaultComparison(project, build, snapshot)),
    ).toBeNull();
    const result = await runWithStore(
      store,
      async () =>
        await loadDefaultComparison(project, build, {
          ...snapshot,
          baselineId: "other",
          infraHash: null,
        }),
    );
    expect(result?.environment).toBe("unknown");
  });
});

describe("default comparison availability", () => {
  it("omits the comparison on the default branch and when no baseline exists", async () => {
    const getFor = vi.spyOn(BaselineModel.prototype, "getFor").mockResolvedValue(null);
    expect(
      await runWithStore(
        store,
        async () => await loadDefaultComparison(project, { ...build, gitBranch: "main" }, snapshot),
      ),
    ).toBeNull();
    expect(getFor).not.toHaveBeenCalled();
    expect(
      await runWithStore(store, async () => await loadDefaultComparison(project, build, snapshot)),
    ).toBeNull();
  });
  it("offers an advanced baseline even with the same id and reports matching fingerprints", async () => {
    vi.spyOn(BaselineModel.prototype, "getFor").mockResolvedValue({
      ...baseline,
      updatedAt: "t2",
      infraHash: "hash",
    });
    const result = await runWithStore(
      store,
      async () => await loadDefaultComparison(project, build, { ...snapshot, infraHash: "hash" }),
    );
    expect(result).toMatchObject({ version: "t2", environment: "matching" });
  });
  it.each([false, "error"] as const)("reports unavailable storage (%s)", async (behavior) => {
    vi.spyOn(BaselineModel.prototype, "getFor").mockResolvedValue({ ...baseline, updatedAt: "t2" });
    const unavailable = {
      ...store,
      storage: {
        exists: async () => {
          if (behavior === "error") throw new Error("storage unavailable");
          return false;
        },
      },
    } as unknown as Store;
    const result = await runWithStore(
      unavailable,
      async () => await loadDefaultComparison(project, build, snapshot),
    );
    expect(result?.available).toBe(false);
  });
});
