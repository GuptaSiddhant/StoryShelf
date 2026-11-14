import { computeAffected, gitRepoRoot } from "@storyshelf/affected";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { createClient, SkippedBuildCreated, SkipSource } from "../client.ts";
import { printLine } from "../output.ts";

/** What the skip path needs from the resolved upload options. */
export interface SkipContext {
  slug: string;
  sha: string;
  branch: string;
  cwd: string;
  buildDir: string;
  untraced: string[];
  statsFile?: string;
  message?: string;
  authorEmail?: string;
  authorName?: string;
  label?: string[];
}

/** Files that define stories; a deleted one removes stories the empty affected set cannot show. */
const STORY_FILE = /\.(?:stories|story)\.[cm]?[jt]sx?$|\.mdx$/u;

/**
 * Try to record this commit as a skipped build (ADR 0044, decision 2) instead of uploading.
 * Resolves `true` only when the server created the skipped build; every other outcome, errors
 * included, prints one line saying why and resolves `false`, so the caller uploads normally.
 * Never throws: skipping is an optimisation and must not fail an upload.
 */
export async function trySkipUnchanged(
  client: ReturnType<typeof createClient>,
  ctx: SkipContext,
): Promise<boolean> {
  try {
    return await attemptSkip(client, ctx);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    printLine(`Uploading normally (skip check failed: ${reason})`);
    return false;
  }
}

/** The skip flow; may throw, which `trySkipUnchanged` turns into a normal upload. */
async function attemptSkip(
  client: ReturnType<typeof createClient>,
  ctx: SkipContext,
): Promise<boolean> {
  if ((ctx.label ?? []).length > 0) {
    printLine("Uploading normally (labels given: a skipped build carries no labels)");
    return false;
  }
  const source = await client.projects.builds.skipSource(ctx.slug, ctx.branch, ctx.sha);
  if (source === null) {
    printLine("Uploading normally (no earlier approved build to skip from)");
    return false;
  }
  return await skipFrom(client, ctx, source);
}

/** Trace the change against the source commit and, when no story is affected, record the skip. */
async function skipFrom(
  client: ReturnType<typeof createClient>,
  ctx: SkipContext,
  source: SkipSource,
): Promise<boolean> {
  const result = await computeAffected({
    cwd: ctx.cwd,
    buildDir: ctx.buildDir,
    baseSha: source.sha,
    headSha: ctx.sha,
    untraced: ctx.untraced,
    statsFile: ctx.statsFile,
  });
  const why = notSkippableReason(ctx.cwd, result);
  if (why !== null) {
    printLine(`Uploading normally (${why})`);
    return false;
  }
  const created = await postSkipped(client, ctx, source, result.changedFiles);
  printLine(
    `Skipped: no story changed since ${source.sha.slice(0, 7)} (build ${created.build.id})`,
  );
  return true;
}

/** Ask the server to record the skipped build. */
async function postSkipped(
  client: ReturnType<typeof createClient>,
  ctx: SkipContext,
  source: SkipSource,
  changedFiles: string[],
): Promise<SkippedBuildCreated> {
  const hasAuthor = ctx.authorEmail !== undefined || ctx.authorName !== undefined;
  return await client.projects.builds.createSkipped(ctx.slug, {
    gitSha: ctx.sha,
    gitBranch: ctx.branch,
    sourceBuildId: source.sourceBuildId,
    changedFiles,
    message: ctx.message,
    author: hasAuthor ? { email: ctx.authorEmail, name: ctx.authorName } : undefined,
  });
}

/** Why the computed result may not be skipped, or `null` when no story is affected. */
function notSkippableReason(
  cwd: string,
  result: Awaited<ReturnType<typeof computeAffected>>,
): string | null {
  if (result.affectedImportPaths === null) {
    return `full capture needed: ${result.fullReason ?? "unknown reason"}`;
  }
  if (result.affectedImportPaths.length > 0) {
    return `${result.affectedImportPaths.length} affected stories`;
  }
  if (hasDeletedStoryFile(cwd, result.changedFiles)) {
    return "a story file was removed or renamed";
  }
  return null;
}

/** True when a changed story file no longer exists, so the new index cannot show what it lost. */
function hasDeletedStoryFile(cwd: string, changedFiles: string[]): boolean {
  const root = gitRepoRoot(cwd) ?? cwd;
  return changedFiles.some((file) => STORY_FILE.test(file) && !existsSync(resolve(root, file)));
}
