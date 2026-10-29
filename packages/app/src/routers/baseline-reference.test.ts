import { BaselineModel, BuildModel, SnapshotModel } from "@storyshelf/core/models";
import type { Baseline, Build, Project, Snapshot } from "@storyshelf/core/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runWithStore, type Store } from "../store.ts";
import { loadBaselineReference } from "./baseline-reference.ts";

const project = { id: "p", gitDefaultBranch: "main" } as Project;
const build = { gitBranch: "feature" } as Build;
const snapshot = {
  baselineId: "base",
  baselineVersion: "t1",
  storyId: "story",
  viewportName: "desktop",
} as Snapshot;
const baseline = { id: "base", updatedAt: "t1", branch: "main", snapshotId: "source" } as Baseline;
const store = { db: { tables: {} } } as Store;
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
