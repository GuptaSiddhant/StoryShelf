import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildScratchDir,
  removeBuildScratch,
  SCRATCH_DIRNAME,
  SCRATCH_MAX_AGE_MS,
  sweepOrphanedScratch,
} from "./scratch.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "storyshelf-scratch-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function seed(projectId: string, buildId: string, ageMs = 0): Promise<string> {
  const dir = buildScratchDir(root, projectId, buildId);
  await mkdir(join(dir, "storybook"), { recursive: true });
  await writeFile(join(dir, "storybook", "index.html"), "x");
  const when = new Date(Date.now() - ageMs);
  await utimes(dir, when, when);
  return dir;
}

const exists = async (path: string): Promise<boolean> =>
  await readdir(path).then(
    () => true,
    () => false,
  );

describe("removeBuildScratch", () => {
  it("removes only the given build's scratch dir", async () => {
    const mine = await seed("p1", "b1");
    const other = await seed("p1", "b2");
    await removeBuildScratch(root, "p1", "b1");
    expect(await exists(mine)).toBe(false);
    expect(await exists(other)).toBe(true);
  });

  it("never touches storage keys that share the scratch root", async () => {
    const storageKey = join(root, "p1", "builds", "b1", "storybook");
    await mkdir(storageKey, { recursive: true });
    await writeFile(join(storageKey, "manifest.json"), "{}");
    await seed("p1", "b1");
    await removeBuildScratch(root, "p1", "b1");
    expect(await exists(storageKey)).toBe(true);
  });

  it("does not throw when there is nothing to remove", async () => {
    await expect(removeBuildScratch(root, "p1", "missing")).resolves.toBeUndefined();
  });
});

describe("sweepOrphanedScratch", () => {
  it("removes stale build dirs and keeps recent ones", async () => {
    const stale = await seed("p1", "old", SCRATCH_MAX_AGE_MS + 60_000);
    const fresh = await seed("p1", "live", 1000);
    expect(await sweepOrphanedScratch(root)).toBe(1);
    expect(await exists(stale)).toBe(false);
    expect(await exists(fresh)).toBe(true);
  });

  it("drops a project dir once it is empty", async () => {
    await seed("gone", "old", SCRATCH_MAX_AGE_MS + 60_000);
    await sweepOrphanedScratch(root);
    expect(await exists(join(root, SCRATCH_DIRNAME, "gone"))).toBe(false);
  });

  it("honours a custom max age", async () => {
    const dir = await seed("p1", "b1", 5000);
    expect(await sweepOrphanedScratch(root, { maxAgeMs: 1000 })).toBe(1);
    expect(await exists(dir)).toBe(false);
  });

  it("is a no-op when no scratch tree exists", async () => {
    expect(await sweepOrphanedScratch(join(root, "nope"))).toBe(0);
  });
});
