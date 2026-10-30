import { describe, expect, it } from "vitest";
import type { Baseline, Build, Snapshot } from "../schema/index.ts";
import { resolveBaselineOrigin, type BaselineOriginReader } from "./baseline-origin.ts";

const original = {
  id: "a",
  projectId: "p",
  storyId: "story",
  viewportName: "desktop",
  browser: "chromium",
  screenshotPath: "image",
  snapshotId: "rendered",
  updatedAt: "v1",
} as Baseline;
const rendered = {
  id: "rendered",
  projectId: "p",
  storyId: "story",
  viewportName: "desktop",
  browser: "chromium",
  screenshotPath: "image",
  inherited: false,
  buildId: "source",
} as Snapshot;
const inherited = {
  ...rendered,
  id: "reused",
  inherited: true,
  buildId: "other",
  baselineId: "a",
  baselineVersion: "v1",
} as Snapshot;
const child = { ...original, id: "b", snapshotId: "reused" };
const build = { id: "source", projectId: "p" } as Build;
function reader(
  baselines: Baseline[] = [original],
  snapshots: Snapshot[] = [rendered, inherited],
  builds: Build[] = [build],
): BaselineOriginReader {
  return {
    baseline: async (id) => baselines.find((row) => row.id === id) ?? null,
    snapshot: async (id) => snapshots.find((row) => row.id === id) ?? null,
    build: async (id) => builds.find((row) => row.id === id) ?? null,
  };
}

describe("baseline image origin", () => {
  it("identifies the renderer and follows a verified inherited image", async () => {
    expect(await resolveBaselineOrigin(original, reader())).toEqual(build);
    expect(await resolveBaselineOrigin(child, reader())).toEqual(build);
  });
  it("uses persisted source even when older snapshot rows are gone", async () => {
    expect(
      await resolveBaselineOrigin({ ...original, sourceBuildId: "source" }, reader([], [])),
    ).toEqual(build);
    expect(
      await resolveBaselineOrigin(
        child,
        reader([{ ...original, sourceBuildId: "source" }], [inherited]),
      ),
    ).toEqual(build);
    expect(
      await resolveBaselineOrigin({ ...original, sourceBuildId: "missing" }, reader([], [])),
    ).toBeNull();
  });
  it("does not guess when inherited provenance is missing or moved", async () => {
    expect(
      await resolveBaselineOrigin(child, reader([{ ...original, updatedAt: "v2" }])),
    ).toBeNull();
    expect(await resolveBaselineOrigin(child, reader([]))).toBeNull();
    expect(await resolveBaselineOrigin({ ...original, snapshotId: null }, reader())).toBeNull();
    expect(await resolveBaselineOrigin(original, reader([original], [rendered], []))).toBeNull();
  });
  it("rejects incompatible images, identities, projects and cyclic chains", async () => {
    for (const changed of [
      { screenshotPath: "other" },
      { projectId: "other" },
      { storyId: "other" },
      { viewportName: "other" },
      { browser: "firefox" },
    ]) {
      expect(
        // oxlint-disable-next-line eslint/no-await-in-loop -- independent identity checks
        await resolveBaselineOrigin(original, reader([original], [{ ...rendered, ...changed }])),
      ).toBeNull();
    }
    expect(
      await resolveBaselineOrigin(
        original,
        reader([original], [rendered], [{ ...build, projectId: "other" }]),
      ),
    ).toBeNull();
    expect(
      await resolveBaselineOrigin(child, reader([{ ...original, snapshotId: "reused" }])),
    ).toBeNull();
  });
});
