/* oxlint-disable max-statements */
import {
  computeAffected,
  gitBranchName,
  gitHeadSha,
  LOCAL_BRANCH,
  localSha,
  selectAffectedStories,
  type AffectedResult,
} from "@storyshelf/affected";
import { ZipArchive } from "archiver";
import { resolve } from "node:path";
import * as picomatch from "picomatch";
import {
  buildPageUrl,
  createClient,
  describeBuildLink,
  normalizeBaseUrl,
  RequestError,
  type BuildCreated,
} from "../client.ts";
import { loadStorybookConfig, type StorybookConfig } from "../config.ts";
import {
  createReporter,
  describeByteProgress,
  formatBytes,
  type PhaseHandle,
  printLine,
  type Reporter,
} from "../output.ts";
import {
  HashRoutesMissingError,
  isOverInlineLimit,
  measureBuild,
  uploadFileByFile,
} from "./file-by-file.ts";
import { readEntries, readEntryIds } from "./index-entries.ts";
import { parseLabels } from "./labels.ts";
import { collectPackageUsage } from "./package-usage.ts";
import { assertBuildOutput, ensureBuildDir } from "./storybook-build.ts";
import { findSupersedes } from "./supersede.ts";
import { trySkipUnchanged } from "./upload-skip.ts";
import { parseTimeout, reportOutcome, waitForBuild, DEFAULT_WAIT_TIMEOUT_MS } from "./wait.ts";
import type { WaitOptions } from "./wait.ts";

/**
 * Upload a built Storybook and create a build record.
 *
 * @param options - Upload command options.
 */
export async function runUpload(options: UploadOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const reporter = options.reporter ?? createReporter();
  const collected = await reporter.phase("Checking config", "Checked config", async () => {
    const cfg = await loadStorybookConfig(cwd, options.config);
    const found = collectUploadOptions(cwd, options, cfg);
    if (found.synthesized) {
      printLine(
        `No git checkout detected — using synthetic identity sha=${found.sha} branch="${found.branch}" (pass --sha/--branch to override)`,
      );
    }
    if (shouldSkipUpload(found.skip, found.branch)) {
      printLine(`Skipped per config skip="${found.skip}" for branch "${found.branch}"`);
      return null;
    }
    assertUploadOptions(found);
    assertWaitOptions(options);
    return found;
  });
  if (collected === null) {
    return;
  }
  await buildAndPost(reporter, cwd, collected, options.forceBuild, options.dryRun, options);
}

/** `--timeout` needs `--wait` and must parse, so a typo fails before any build work. */
function assertWaitOptions(options: UploadOptions): void {
  if (options.timeout !== undefined && options.wait !== true) {
    throw new Error("--timeout only applies with --wait");
  }
  if (options.timeout !== undefined) parseTimeout(options.timeout);
}

/** Options for the `upload` command. */
export interface UploadOptions {
  /** Server base URL. */
  url?: string;
  /** Project slug. */
  slug?: string;
  /** CI token. */
  token?: string;
  /** Revision SHA — a git commit or any unique build pointer. */
  sha?: string;
  /** Baseline namespace — a git branch, environment, or channel. */
  branch?: string;
  /** Built Storybook directory. Defaults to `storybook-static`. */
  buildDir?: string;
  /** Custom config file path. */
  config?: string;
  /** Build command. */
  buildCommand?: string;
  /** Build script name. */
  buildScriptName?: string;
  /** Force rebuild even if buildDir exists. */
  forceBuild?: boolean;
  /** Skip pattern (glob). */
  skip?: string;
  /** Commit message. */
  message?: string;
  /** Author email. */
  authorEmail?: string;
  /** Author name. */
  authorName?: string;
  /** Build labels as `key=value` strings (repeatable). */
  label?: string[];
  /** Disable affected capture and render every story. */
  full?: boolean;
  /** Record a commit that changed no story as a skipped build instead of uploading. */
  skipUnchanged?: boolean;
  /** Explicit affected-capture opt-in/out (default on; `full` wins). */
  affectedOnly?: boolean;
  /** Append `--stats-json` to the build script (default on; `--no-build-stats` opts out). */
  buildStats?: boolean;
  /** Files excluded from affected tracing (repeatable globs). */
  untraced?: string[];
  /** Bundler stats file for affected tracing (default `<buildDir>/preview-stats.json`). */
  statsFile?: string;
  /** Upload a zip instead of hashing files (for servers without the hash routes). */
  zip?: boolean;
  /** Validate everything but send no requests. */
  dryRun?: boolean;
  /** Working directory (defaults to process.cwd()). Test seam for fs access. */
  cwd?: string;
  /** After the upload, follow the build until it stops needing the server and exit by how it ended. */
  wait?: boolean;
  /** How long `wait` follows the build: `90`, `90s`, `30m` or `2h` (default 30m). Never cancels the build. */
  timeout?: string;
  /** Test seam: the clock, sleep and abort signal of the wait. */
  waitDeps?: Pick<WaitOptions, "now" | "sleep" | "signal">;
  /** Phase reporter (defaults to one writing to stderr). Test seam for the clock and terminal. */
  reporter?: Reporter;
}

/** Git probe for identity auto-detection; injectable for tests. */
export interface GitIdentityProbe {
  headSha: (cwd: string) => string | null;
  branchName: (cwd: string) => string | null;
}

const defaultProbe: GitIdentityProbe = { headSha: gitHeadSha, branchName: gitBranchName };

/** Resolved sha/branch plus whether either was synthesized locally. */
export interface ResolvedIdentity {
  sha: string;
  branch: string;
  synthesized: boolean;
}

/**
 * Resolve sha/branch per field: flags > env > local git > synthesized local
 * identity. Synthesis always succeeds, so checkouts without git can upload
 * with zero identity flags.
 */
export function resolveIdentity(
  cwd: string,
  options: Pick<UploadOptions, "sha" | "branch">,
  probe: GitIdentityProbe = defaultProbe,
): ResolvedIdentity {
  const sha = options.sha ?? envOf("GITHUB_SHA", "VERCEL_GIT_COMMIT_SHA", "CI_COMMIT_SHA");
  const branch =
    options.branch ?? envOf("GITHUB_REF_NAME", "VERCEL_GIT_COMMIT_REF", "CI_COMMIT_REF_NAME");
  return {
    sha: sha ?? probe.headSha(cwd) ?? localSha(),
    branch: branch ?? probe.branchName(cwd) ?? LOCAL_BRANCH,
    synthesized: sha === undefined || branch === undefined,
  };
}

interface CollectedUploadOptions {
  url?: string;
  slug?: string;
  token?: string;
  sha: string;
  branch: string;
  synthesized: boolean;
  buildDir: string;
  buildCommand?: string;
  buildScriptName?: string;
  skip?: string;
  message?: string;
  authorEmail?: string;
  authorName?: string;
  label?: string[];
  affectedOnly: boolean;
  skipUnchanged: boolean;
  buildStats: boolean;
  untraced: string[];
  statsFile?: string;
  zip: boolean;
}

interface ResolvedUploadOptions extends CollectedUploadOptions {
  url: string;
  slug: string;
  token: string;
  sha: string;
  branch: string;
}

/** First set value among the given env var names. */
function envOf(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      return value;
    }
  }
  return undefined;
}

/** Layer explicit options over env and the client config file. */
function collectUploadOptions(
  cwd: string,
  options: UploadOptions,
  cfg: StorybookConfig | null,
): CollectedUploadOptions {
  const identity = resolveIdentity(cwd, options);
  return {
    url: resolveServerUrl(options, cfg),
    slug: options.slug ?? cfg?.slug ?? envOf("STORYSHELF_SLUG"),
    token: options.token ?? envOf("STORYSHELF_TOKEN", "SHELF_TOKEN"),
    sha: identity.sha,
    branch: identity.branch,
    synthesized: identity.synthesized,
    buildDir: options.buildDir ?? cfg?.buildDir ?? "storybook-static",
    buildCommand: options.buildCommand ?? cfg?.buildCommand,
    buildScriptName: options.buildScriptName ?? cfg?.buildScriptName,
    skip: options.skip ?? cfg?.skip,
    message: options.message,
    authorEmail: options.authorEmail,
    authorName: options.authorName,
    label: options.label,
    affectedOnly: resolveAffectedOnly(options, cfg),
    skipUnchanged: resolveSkipUnchanged(options, cfg),
    buildStats: resolveBuildStats(options, cfg),
    untraced: mergeUntraced(cfg?.untraced, options.untraced),
    statsFile: options.statsFile,
    zip: options.zip === true || envOf("STORYSHELF_ZIP") === "1",
  };
}

/** The server URL from flag, config file or env, without a trailing slash. */
function resolveServerUrl(options: UploadOptions, cfg: StorybookConfig | null): string | undefined {
  const url = options.url ?? cfg?.url ?? envOf("STORYSHELF_URL");
  return url === undefined ? undefined : normalizeBaseUrl(url);
}

/** Add `--stats-json` to the build script unless `--no-build-stats` or `buildStats: false`. */
function resolveBuildStats(options: UploadOptions, cfg: StorybookConfig | null): boolean {
  return options.buildStats ?? cfg?.buildStats ?? true;
}

/** Combine config-file and flag untraced globs, deduplicated in order. */
function mergeUntraced(configured: string[] | undefined, flagged: string[] | undefined): string[] {
  return [...new Set([...(configured ?? []), ...(flagged ?? [])])];
}

/** Affected capture is on by default; `--full` (or `STORYSHELF_FULL=1`) opts out. */
function resolveAffectedOnly(options: UploadOptions, cfg: StorybookConfig | null): boolean {
  if (options.full === true || envOf("STORYSHELF_FULL") === "1") {
    return false;
  }
  return options.affectedOnly ?? cfg?.affectedOnly ?? true;
}

/** Skipping is opt-in (flag, `STORYSHELF_SKIP_UNCHANGED=1` or config); `--full` always wins. */
function resolveSkipUnchanged(options: UploadOptions, cfg: StorybookConfig | null): boolean {
  if (!resolveAffectedOnly(options, cfg)) {
    return false;
  }
  return (
    options.skipUnchanged ??
    (envOf("STORYSHELF_SKIP_UNCHANGED") === "1" || cfg?.skipUnchanged) ??
    false
  );
}

/** Throw on the first missing required upload option. */
function assertUploadOptions(
  collected: CollectedUploadOptions,
): asserts collected is ResolvedUploadOptions {
  if (!collected.url) {
    throw new Error("--url is required (or .storybook/storyshelf.json / STORYSHELF_URL)");
  }
  if (!collected.slug) {
    throw new Error("--slug is required (or .storybook/storyshelf.json / STORYSHELF_SLUG)");
  }
  if (!collected.token) {
    throw new Error("--token is required (or STORYSHELF_TOKEN env)");
  }
}

function shouldSkipUpload(skip: string | undefined, branch: string | undefined): boolean {
  return Boolean(skip && branch && picomatch.isMatch(branch, skip));
}

/** Zip the built Storybook directory as a stream (bounded memory). */
function zipBuildDirStream(
  cwd: string,
  buildDir: string,
  onProgress?: (processedBytes: number) => void,
): ZipArchive {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on("progress", (data: { fs: { processedBytes: number } }) => {
    onProgress?.(data.fs.processedBytes);
  });
  archive.on("warning", (warning: Error) => {
    printLine(`Zip warning: ${warning.message}`);
  });
  archive.on("error", (error: Error) => {
    archive.destroy(error);
  });
  archive.directory(resolve(cwd, buildDir), false);
  archive.finalize().catch(() => {
    // Intentionally empty — finalize failures also emit 'error' above
  });
  return archive;
}

/** Ensure, create, and stream the build directory, one reported phase per step. */
// oxlint-disable-next-line eslint(max-statements) -- buildAndPost orchestrates the phases in order
async function buildAndPost(
  reporter: Reporter,
  cwd: string,
  collected: ResolvedUploadOptions,
  force?: boolean,
  dryRun?: boolean,
  waitOptions?: Pick<UploadOptions, "wait" | "timeout" | "waitDeps">,
): Promise<void> {
  await reporter.phase("Building Storybook", "Built Storybook", async () => {
    await ensureBuildDir({
      cwd,
      buildDir: collected.buildDir,
      buildCommand: collected.buildCommand,
      buildScriptName: collected.buildScriptName,
      force,
      affected: collected.affectedOnly,
      buildStats: collected.buildStats,
      statsFile: collected.statsFile,
    });
    await assertBuildOutput(cwd, collected.buildDir);
  });
  if (dryRun) {
    printLine(
      `Dry run: would upload ${collected.buildDir} as ${collected.sha} on ${collected.branch}`,
    );
    return;
  }
  const client = createClient(collected.url, collected.token);
  if (collected.skipUnchanged && (await skipPhase(reporter, client, cwd, collected))) {
    return;
  }
  const created = await reporter.phase("Creating build", "Created build", async () => {
    const supersedes = await findSupersedes(client, {
      slug: collected.slug,
      cwd,
      branch: collected.branch,
      headSha: collected.sha,
    });
    return await createBuild(client, collected, supersedes);
  });
  await finishUpload(reporter, { client, created, cwd, collected, wait: waitOptions });
}

/** Everything a phase after the build exists needs. */
interface UploadContext {
  client: ReturnType<typeof createClient>;
  created: BuildCreated;
  cwd: string;
  collected: ResolvedUploadOptions;
  wait?: Pick<UploadOptions, "wait" | "timeout" | "waitDeps"> | undefined;
}

/** The affected, package-usage and upload phases, then the summary. */
async function finishUpload(reporter: Reporter, ctx: UploadContext): Promise<void> {
  const { client, created, cwd, collected } = ctx;
  const hostingOnly = created.testing === false;
  const stories = hostingOnly
    ? undefined
    : await reporter.phase("Selecting affected stories", "Selected affected stories", async () => {
        return await reportAffectedCapture(client, created, cwd, collected);
      });
  await reporter.phase("Recording package usage", "Recorded package usage", async () => {
    await reportPackageUsage(client, created, cwd, collected);
  });
  const sent = await reporter.phase("Uploading Storybook", "Uploaded Storybook", async (handle) => {
    return await uploadBuild(client, created, cwd, collected, handle);
  });
  printSummary({ ...sent, stories, hostingOnly, total: totalStories(cwd, collected.buildDir) }, [
    `Build:    ${created.build.id}`,
    `Time:     ${reporter.elapsed()}`,
    describeBuildLink(collected.url, created.build, created.buildUrl),
  ]);
  if (hostingOnly) {
    printLine(HOSTING_ONLY_NOTICE);
  }
  if (ctx.wait?.wait === true) {
    await followBuild(reporter, ctx, hostingOnly);
  }
}

/** Follow the build (`--wait`); Ctrl+C stops the wait only. The exit code says how it ended. */
async function followBuild(
  reporter: Reporter,
  ctx: UploadContext,
  hostingOnly: boolean,
): Promise<void> {
  const { client, created, collected, wait } = ctx;
  const controller = new AbortController();
  const stop = (): void => {
    controller.abort();
  };
  process.once("SIGINT", stop);
  try {
    const result = await waitForBuild({
      client,
      slug: collected.slug,
      buildId: created.build.id,
      buildLink: buildPageUrl(collected.url, created.buildUrl),
      hostingOnly,
      timeoutMs: wait?.timeout === undefined ? DEFAULT_WAIT_TIMEOUT_MS : parseTimeout(wait.timeout),
      reporter,
      signal: controller.signal,
      ...wait?.waitDeps,
    });
    const code = reportOutcome(result);
    if (code !== 0) process.exitCode = code;
  } finally {
    process.off("SIGINT", stop);
  }
}

/** The skip check as a phase; true when the commit was recorded as skipped. */
async function skipPhase(
  reporter: Reporter,
  client: ReturnType<typeof createClient>,
  cwd: string,
  collected: ResolvedUploadOptions,
): Promise<boolean> {
  return await reporter.phase("Checking for unchanged stories", "Checked for changes", async () => {
    return await trySkipUnchanged(client, { ...collected, cwd });
  });
}

/** What the summary block says about the upload. */
interface UploadSummary {
  files: number;
  bytes: number;
  /** Affected count; null is a full capture; undefined means no capture ran. */
  stories: number | null | undefined;
  hostingOnly: boolean;
  total: number | null;
}

/** Number of catalog entries in the built Storybook, or null when its index cannot be read. */
function totalStories(cwd: string, buildDir: string): number | null {
  return readEntryIds(cwd, buildDir)?.length ?? null;
}

/** Print the result block to stdout: files, size, stories affected, then the given lines. */
function printSummary(summary: UploadSummary, lines: string[]): void {
  printLine("Summary");
  printLine(`  Files:    ${summary.files}`);
  printLine(`  Size:     ${formatBytes(summary.bytes)}`);
  printLine(`  Stories:  ${describeStories(summary)}`);
  for (const line of lines.slice(0, -1)) printLine(`  ${line}`);
  printLine(lines.at(-1) ?? "");
}

function describeStories(summary: UploadSummary): string {
  if (summary.hostingOnly) return "not captured (testing is off)";
  if (typeof summary.stories === "number") {
    return summary.total === null
      ? `${summary.stories} affected`
      : `${summary.stories} of ${summary.total} affected`;
  }
  return summary.total === null ? "full capture" : `full capture (${summary.total} stories)`;
}

/** Create the build record, naming the builds it supersedes (ADR 0045). */
async function createBuild(
  client: ReturnType<typeof createClient>,
  collected: ResolvedUploadOptions,
  supersedes: string[] | undefined,
): Promise<BuildCreated> {
  return await client.projects.builds.createJson(collected.slug, {
    gitSha: collected.sha,
    gitBranch: collected.branch,
    message: collected.message,
    authorEmail: collected.authorEmail,
    authorName: collected.authorName,
    affectedOnly: collected.affectedOnly,
    labels: parseLabels(collected.label),
    ...(supersedes && { supersedes }),
  });
}

/** Printed when the server reports `testing: false` (ADR 0006, decision 1). */
export const HOSTING_ONLY_NOTICE =
  "Testing is off on this server: the Storybook is published, but no captures or visual checks will run.";

/** Post which dependency packages each story uses; best effort, never fails the upload. */
async function reportPackageUsage(
  client: ReturnType<typeof createClient>,
  created: BuildCreated,
  cwd: string,
  collected: ResolvedUploadOptions,
): Promise<void> {
  try {
    const usage = await collectPackageUsage({
      cwd,
      buildDir: collected.buildDir,
      statsFile: collected.statsFile,
    });
    if (usage.length > 0) {
      await client.projects.builds.postUsage(collected.slug, created.build.id, usage);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    printLine(`Package usage not recorded: ${reason}`);
  }
}

/** Compute the affected set and post it, never failing the upload; the count is null for a full capture. */
async function reportAffectedCapture(
  client: ReturnType<typeof createClient>,
  created: BuildCreated,
  cwd: string,
  collected: ResolvedUploadOptions,
): Promise<number | null> {
  if (!collected.affectedOnly) {
    printLine("Full capture (--full): rendering all stories");
    return null;
  }
  if (!created.baselineSha) {
    printLine("Full capture (no baseline build yet): rendering all stories");
    return null;
  }
  try {
    const result = await computeAffected({
      cwd,
      buildDir: collected.buildDir,
      baseSha: created.baselineSha,
      headSha: collected.sha,
      untraced: collected.untraced,
      statsFile: collected.statsFile,
    });
    await client.projects.builds.postAffected(collected.slug, created.build.id, {
      baselineSha: result.baselineSha,
      changedFiles: result.changedFiles,
      affectedImportPaths: result.affectedImportPaths,
    });
    const count = countAffectedStories(cwd, collected.buildDir, result.affectedImportPaths);
    printLine(describeAffected(result, count, created.baselineSha));
    return count;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    printLine(`Full capture (affected post failed: ${reason}): rendering all stories`);
    return null;
  }
}

/**
 * Stories the server will render for these affected import paths (one file can hold many), or the
 * path count when the index cannot be read. Null is a full capture.
 */
function countAffectedStories(
  cwd: string,
  buildDir: string,
  paths: readonly string[] | null,
): number | null {
  if (paths === null) return null;
  const entries = readEntries(cwd, buildDir);
  return entries === null ? paths.length : selectAffectedStories(entries, paths).render.length;
}

/** Human-readable summary of an affected computation. */
function describeAffected(
  result: AffectedResult,
  count: number | null,
  baselineSha: string,
): string {
  if (result.affectedImportPaths === null) {
    return `Full capture (${result.fullReason ?? "unknown reason"}): rendering all stories`;
  }
  const short = baselineSha.slice(0, 7);
  if (count === null || count === 0) {
    return `Affected capture: no stories affected (baseline ${short})`;
  }
  return `Affected capture: rendering ${count} ${count === 1 ? "story" : "stories"} (baseline ${short})`;
}

/**
 * Send the build by content hash (only the files the server lacks, then the manifest). `--zip`,
 * or a server without the hash routes (404 from `/dedup`), sends a zip instead; a zip the server
 * refuses over its inline publish limit goes file by file.
 */
async function uploadBuild(
  client: ReturnType<typeof createClient>,
  created: BuildCreated,
  cwd: string,
  collected: ResolvedUploadOptions,
  handle: PhaseHandle,
): Promise<{ files: number; bytes: number }> {
  const measured = await measureBuild(cwd, collected.buildDir);
  const target = {
    slug: collected.slug,
    buildId: created.build.id,
    cwd,
    buildDir: collected.buildDir,
  };
  if (!collected.zip) {
    try {
      await uploadFileByFile(client, target, printLine, (text) => {
        handle.progress(text);
      });
      return measured;
    } catch (error) {
      if (!(error instanceof HashRoutesMissingError)) {
        throw error;
      }
      printLine("The server has no hash upload routes; uploading a zip instead");
    }
  }
  try {
    await putZipStream(client, created, cwd, collected.buildDir, handle, measured.bytes);
  } catch (error) {
    if (error instanceof RequestError && error.status === 422) {
      error.message +=
        `\nThe server rejected the Storybook archive. Check its contents and the server's ` +
        `maxZipEntries and maxUnzippedBytes limits, then run storyshelf upload again. ` +
        `That creates a new build; build ${created.build.id} failed and takes no further upload.`;
      throw error;
    }
    if (!isOverInlineLimit(error)) {
      throw error;
    }
    printLine("Zip is over the server's inline publish limit; uploading file by file instead");
    await uploadFileByFile(client, target, printLine, (text) => {
      handle.progress(text);
    });
  }
  return measured;
}

/** PUT the streamed zip, reporting how much of the source bytes the archive has read. */
async function putZipStream(
  client: ReturnType<typeof createClient>,
  created: BuildCreated,
  cwd: string,
  buildDir: string,
  handle: PhaseHandle,
  totalBytes: number,
): Promise<void> {
  const body = zipBuildDirStream(cwd, buildDir, (done) => {
    handle.progress(describeByteProgress(done, totalBytes));
  });
  await client.projects.builds.uploadZip(created.uploadUrl, body);
}
