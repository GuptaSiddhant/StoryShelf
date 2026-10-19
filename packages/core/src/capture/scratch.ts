/** Per-build scratch directories: where they live, removing them, and sweeping crash leftovers. */
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../logger.ts";

/**
 * Subtree of `scratchDir` that holds extracted Storybooks.
 *
 * `scratchDir` is often also the local storage root (dev server, generated servers), where
 * `<project>/builds/<build>/...` holds screenshots and published statics. Keeping scratch in its
 * own subtree means removing it can never touch a storage key.
 */
export const SCRATCH_DIRNAME = ".storyshelf-scratch";

/** Scratch dirs untouched for this long are assumed orphaned by a crash (no capture runs this long). */
export const SCRATCH_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Scratch directory owned by one build: `<scratchDir>/.storyshelf-scratch/<projectId>/<buildId>`. */
export function buildScratchDir(scratchDir: string, projectId: string, buildId: string): string {
  return join(scratchDir, SCRATCH_DIRNAME, projectId, buildId);
}

/** Scratch directory of one shard of a build, inside the build's: shards of a build can share a host. */
export function shardScratchDir(
  scratchDir: string,
  projectId: string,
  buildId: string,
  shardId: string,
): string {
  return join(buildScratchDir(scratchDir, projectId, buildId), "shards", shardId);
}

/** Remove one shard's scratch directory, leaving the build's other shards alone. Best effort. */
export async function removeShardScratch(
  scratchDir: string,
  projectId: string,
  buildId: string,
  shardId: string,
  logger?: Logger,
): Promise<void> {
  try {
    await rm(shardScratchDir(scratchDir, projectId, buildId, shardId), {
      recursive: true,
      force: true,
    });
  } catch (error) {
    logger?.warn({ err: error, buildId, shardId }, "failed to remove shard scratch directory");
  }
}

/** Remove a build's scratch directory. Best effort: a failure is logged, never thrown. */
export async function removeBuildScratch(
  scratchDir: string,
  projectId: string,
  buildId: string,
  logger?: Logger,
): Promise<void> {
  try {
    await rm(buildScratchDir(scratchDir, projectId, buildId), { recursive: true, force: true });
  } catch (error) {
    logger?.warn({ err: error, buildId }, "failed to remove build scratch directory");
  }
}

/** Options for {@link sweepOrphanedScratch}. */
export interface ScratchSweepOptions {
  /** Remove build scratch dirs not modified for this long (default {@link SCRATCH_MAX_AGE_MS}). */
  maxAgeMs?: number;
  /** Clock override for tests. */
  now?: number;
  logger?: Logger;
}

/**
 * Boot-time sweep for scratch dirs a crash left behind. Age-gated rather than wholesale so a
 * second process sharing the same `scratchDir` (server plus worker) keeps its live captures.
 *
 * @returns How many build scratch directories were removed.
 */
export async function sweepOrphanedScratch(
  scratchDir: string,
  options: ScratchSweepOptions = {},
): Promise<number> {
  const root = join(scratchDir, SCRATCH_DIRNAME);
  const cutoff = (options.now ?? Date.now()) - (options.maxAgeMs ?? SCRATCH_MAX_AGE_MS);
  const projects = await readdir(root).catch(() => [] as string[]);
  const removed = await Promise.all(
    projects.map(async (projectId) => await sweepProject(join(root, projectId), cutoff)),
  );
  const total = removed.reduce((sum, count) => sum + count, 0);
  if (total > 0) {
    options.logger?.info({ removed: total }, "removed orphaned capture scratch directories");
  }
  return total;
}

async function sweepProject(projectDir: string, cutoff: number): Promise<number> {
  const builds = await readdir(projectDir).catch(() => [] as string[]);
  const results = await Promise.all(
    builds.map(async (buildId) => await sweepBuild(join(projectDir, buildId), cutoff)),
  );
  // Drop the project dir once empty; `rmdir` semantics via a non-recursive remove that fails if not.
  if ((await readdir(projectDir).catch(() => ["x"])).length === 0) {
    await rm(projectDir, { recursive: true, force: true }).catch(ignore);
  }
  return results.filter(Boolean).length;
}

async function sweepBuild(buildDir: string, cutoff: number): Promise<boolean> {
  try {
    if ((await stat(buildDir)).mtimeMs >= cutoff) {
      return false;
    }
    await rm(buildDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function ignore(): void {}
