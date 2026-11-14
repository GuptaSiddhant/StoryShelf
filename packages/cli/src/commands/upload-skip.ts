import { computeAffected } from "@storyshelf/affected";
import { randomUUID } from "node:crypto";
import {
  RequestError,
  type createClient,
  type SkippedBuildCreated,
  type SkipSource,
} from "../client.ts";
import { printLine } from "../output.ts";
import { readEntryIds } from "./index-entries.ts";
import { parseLabels } from "./labels.ts";

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

/** Attempts at the POST: one, plus retries after a network failure with the same key. */
const POST_ATTEMPTS = 3;

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
  const why = notSkippableReason(result);
  if (why !== null) {
    printLine(`Uploading normally (${why})`);
    return false;
  }
  return await recordSkip(client, ctx, source, result.changedFiles);
}

/** Send the skipped build with the new Storybook's entry ids; false (upload) when they are unreadable. */
async function recordSkip(
  client: ReturnType<typeof createClient>,
  ctx: SkipContext,
  source: SkipSource,
  changedFiles: string[],
): Promise<boolean> {
  const entryIds = readEntryIds(ctx.cwd, ctx.buildDir);
  if (entryIds === null) {
    printLine("Uploading normally (the Storybook index could not be read)");
    return false;
  }
  const created = await postSkipped(client, ctx, source, changedFiles, entryIds);
  printLine(
    `Skipped: no story changed since ${source.sha.slice(0, 7)} (build ${created.build.id})`,
  );
  return true;
}

/**
 * Ask the server to record the skipped build. The key is made once per run, so a retry after a
 * network failure returns the build a lost response already created; a refusal from the server
 * (`RequestError`, such as a `409`) is definite and is not retried.
 */
async function postSkipped(
  client: ReturnType<typeof createClient>,
  ctx: SkipContext,
  source: SkipSource,
  changedFiles: string[],
  entryIds: string[],
): Promise<SkippedBuildCreated> {
  const hasAuthor = ctx.authorEmail !== undefined || ctx.authorName !== undefined;
  const body = {
    gitSha: ctx.sha,
    gitBranch: ctx.branch,
    sourceBuildId: source.sourceBuildId,
    changedFiles,
    entryIds,
    idempotencyKey: randomUUID(),
    labels: parseLabels(ctx.label),
    message: ctx.message,
    author: hasAuthor ? { email: ctx.authorEmail, name: ctx.authorName } : undefined,
  };
  for (let attempt = 1; ; attempt += 1) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- each retry follows the failure of the last
      return await client.projects.builds.createSkipped(ctx.slug, body);
    } catch (error) {
      if (error instanceof RequestError || attempt >= POST_ATTEMPTS) throw error;
    }
  }
}

/** Why the computed result may not be skipped, or `null` when no story is affected. */
function notSkippableReason(result: Awaited<ReturnType<typeof computeAffected>>): string | null {
  if (result.affectedImportPaths === null) {
    return `full capture needed: ${result.fullReason ?? "unknown reason"}`;
  }
  if (result.affectedImportPaths.length > 0) {
    return `${result.affectedImportPaths.length} affected stories`;
  }
  return null;
}
