import { changedFiles, gitRepoRoot, gitRepoStatus, MAX_CHANGED_FILES } from "./git.ts";
import {
  keyOfChangedFile,
  keyOfStoryFile,
  pathBase,
  projectRelative,
  type PathBase,
} from "./paths.ts";
import { loadDepGraph, loadStoryImportPaths, statsPathFor } from "./stats.ts";
import { matchesAnyGlob, traceAffected } from "./trace.ts";
import type { AffectedInput, AffectedResult } from "./types.ts";

/**
 * Compute the affected story set for an upload. Never throws: every failure
 * degrades to a full render with a machine-readable `fullReason`, so
 * affected capture can stay enabled by default without new failure modes.
 *
 * @param input - Repository root, build dir, revisions, and trace options.
 */
export async function computeAffected(input: AffectedInput): Promise<AffectedResult> {
  try {
    return await computeSelective(input);
  } catch {
    return fullResult([], input.baseSha, "affected-computation-failed");
  }
}

/** Full-render result with a reason. */
function fullResult(changed: string[], baselineSha: string | null, reason: string): AffectedResult {
  return { affectedImportPaths: null, changedFiles: changed, baselineSha, fullReason: reason };
}

/** Selective result for an affected import-path set. */
function selectiveResult(changed: string[], baselineSha: string, paths: string[]): AffectedResult {
  return { affectedImportPaths: paths, changedFiles: changed, baselineSha, fullReason: null };
}

/** The roots to resolve paths against, throwing a full-render reason when the checkout can't be diffed. */
function guardedBase(input: AffectedInput): PathBase {
  const repo = gitRepoStatus(input.cwd);
  if (repo !== "ok") {
    throw new Error(repo === "shallow" ? "shallow-clone" : "not-a-git-repo");
  }
  const base = pathBase(gitRepoRoot(input.cwd), input.cwd);
  if (!base) {
    throw new Error("path-base-unknown");
  }
  return base;
}

/** Guarded changed-file list (repo-relative), throwing a full-render reason when unusable. */
function guardedChanged(input: AffectedInput): string[] {
  const changed = changedFiles(input.cwd, input.baseSha, input.headSha);
  if (changed.length > MAX_CHANGED_FILES) {
    throw new Error("too-many-changed-files");
  }
  return changed;
}

/**
 * Whether the user excluded a changed file from tracing. Globs are written next to
 * `.storybook/storyshelf.json`, so they match the project-relative form; the repo-relative form
 * matches too, which is what configs written before monorepo support use.
 */
function isUntraced(file: string, base: PathBase, globs: readonly string[]): boolean {
  return matchesAnyGlob(file, globs) || matchesAnyGlob(projectRelative(base, file), globs);
}

/** Trace the affected set once inputs are validated. Throws reason strings. */
async function traceSelective(
  input: AffectedInput,
  changed: string[],
  base: PathBase,
): Promise<AffectedResult> {
  if (changed.length === 0) {
    return selectiveResult(changed, input.baseSha, []);
  }
  const stories = await loadStoryImportPaths(input.cwd, input.buildDir).catch(() => {
    throw new Error("story-index-unreadable");
  });
  const graph = await loadDepGraph(statsPathFor(input.cwd, input.buildDir, input.statsFile), base);
  if (!graph) {
    throw new Error("dependency-graph-unavailable");
  }
  // Both sides meet as absolute paths; the result keeps the project-relative story paths.
  const storyOf = new Map(stories.map((path) => [keyOfStoryFile(base, path), path] as const));
  const traced = changed.filter((file) => !isUntraced(file, base, input.untraced ?? []));
  const affected = traceAffected(
    graph,
    traced.map((file) => keyOfChangedFile(base, file)),
    [...storyOf.keys()],
  );
  if (affected === null) {
    throw new Error("global-file-changed");
  }
  const paths = affected.map((key) => storyOf.get(key) ?? key).toSorted();
  return selectiveResult(changed, input.baseSha, paths);
}

/** Selective computation with reason-string failures mapped to full renders. */
async function computeSelective(input: AffectedInput): Promise<AffectedResult> {
  let changed: string[] = [];
  try {
    const base = guardedBase(input);
    changed = guardedChanged(input);
    return await traceSelective(input, changed, base);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "affected-computation-failed";
    return fullResult(changed, input.baseSha, reason);
  }
}

export type { AffectedInput, AffectedResult, DepGraph, StoryLike, TraceOptions } from "./types.ts";
export {
  changedFiles,
  gitBranchName,
  gitHeadSha,
  gitRepoRoot,
  gitRepoStatus,
  isShallowRepo,
  LOCAL_BRANCH,
  LOCAL_SHA_PREFIX,
  localSha,
  MAX_CHANGED_FILES,
} from "./git.ts";
export type { GitRepoStatus } from "./git.ts";
export {
  buildGraph,
  graphModulesFor,
  loadDepGraph,
  loadStoryImportPaths,
  normalizePath,
  STATS_FILENAME,
  statsPathFor,
} from "./stats.ts";
export { pathBase, type PathBase } from "./paths.ts";
export { matchesAnyGlob, traceAffected } from "./trace.ts";
export { selectAffectedStories, type StoryPartition } from "./select.ts";
export { extractPackageUsage, type PackageUsage, type TrackedPackage } from "./usage.ts";
