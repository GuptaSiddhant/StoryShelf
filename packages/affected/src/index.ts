import { changedFiles, isShallowRepo, MAX_CHANGED_FILES } from "./git.ts";
import { loadDepGraph, loadStoryImportPaths, statsPathFor } from "./stats.ts";
import { traceAffected } from "./trace.ts";
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

/** Guarded changed-file list, throwing a full-render reason when unusable. */
function guardedChanged(input: AffectedInput): string[] {
  if (isShallowRepo(input.cwd)) {
    throw new Error("shallow-clone");
  }
  const changed = changedFiles(input.cwd, input.baseSha, input.headSha);
  if (changed.length > MAX_CHANGED_FILES) {
    throw new Error("too-many-changed-files");
  }
  return changed;
}

/** Trace the affected set once inputs are validated. Throws reason strings. */
async function traceSelective(input: AffectedInput, changed: string[]): Promise<AffectedResult> {
  if (changed.length === 0) {
    return selectiveResult(changed, input.baseSha, []);
  }
  const stories = await loadStoryImportPaths(input.cwd, input.buildDir).catch(() => {
    throw new Error("story-index-unreadable");
  });
  const graph = await loadDepGraph(statsPathFor(input.cwd, input.buildDir, input.statsFile));
  if (!graph) {
    throw new Error("dependency-graph-unavailable");
  }
  const affected = traceAffected(graph, changed, stories, { untraced: input.untraced });
  if (affected === null) {
    throw new Error("global-file-changed");
  }
  return selectiveResult(changed, input.baseSha, affected);
}

/** Selective computation with reason-string failures mapped to full renders. */
async function computeSelective(input: AffectedInput): Promise<AffectedResult> {
  let changed: string[] = [];
  try {
    changed = guardedChanged(input);
    return await traceSelective(input, changed);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "affected-computation-failed";
    return fullResult(changed, input.baseSha, reason);
  }
}

export type { AffectedInput, AffectedResult, DepGraph, StoryLike, TraceOptions } from "./types.ts";
export { changedFiles, isShallowRepo, MAX_CHANGED_FILES } from "./git.ts";
export {
  buildGraph,
  graphModulesFor,
  loadDepGraph,
  loadStoryImportPaths,
  normalizePath,
  STATS_FILENAME,
  statsPathFor,
} from "./stats.ts";
export { matchesAnyGlob, traceAffected } from "./trace.ts";
export { selectAffectedStories, type StoryPartition } from "./select.ts";
