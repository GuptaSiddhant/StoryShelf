/* oxlint-disable max-statements */
import { computeAffected, type AffectedResult } from "@storyshelf/affected";
import { ZipArchive } from "archiver";
import { resolve } from "node:path";
import * as picomatch from "picomatch";
import { createClient, type BuildCreated } from "../client.ts";
import { loadStorybookConfig, type StorybookConfig } from "../config.ts";
import { createSpinner, printLine, spinnerFrames } from "../output.ts";
import { assertBuildOutput, ensureBuildDir } from "./storybook-build.ts";

/**
 * Upload a built Storybook and create a build record.
 *
 * @param options - Upload command options.
 */
export async function runUpload(options: UploadOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const cfg = await loadStorybookConfig(cwd, options.config);
  const collected = collectUploadOptions(options, cfg);
  if (shouldSkipUpload(collected.skip, collected.branch)) {
    printLine(`Skipped per config skip="${collected.skip}" for branch "${collected.branch}"`);
    return;
  }
  assertUploadOptions(collected);
  await buildAndPost(cwd, collected, options.forceBuild, options.dryRun);
}

/** Options for the `upload` command. */
export interface UploadOptions {
  /** Server base URL. */
  url?: string;
  /** Project slug. */
  slug?: string;
  /** CI token. */
  token?: string;
  /** Git commit SHA. */
  sha?: string;
  /** Git branch. */
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
  /** Explicit affected-capture opt-in/out (default on; `full` wins). */
  affectedOnly?: boolean;
  /** Files excluded from affected tracing (repeatable globs). */
  untraced?: string[];
  /** Bundler stats file for affected tracing (default `<buildDir>/preview-stats.json`). */
  statsFile?: string;
  /** Validate everything but send no requests. */
  dryRun?: boolean;
  /** Working directory (defaults to process.cwd()). Test seam for fs access. */
  cwd?: string;
}

interface CollectedUploadOptions {
  url?: string;
  slug?: string;
  token?: string;
  sha?: string;
  branch?: string;
  buildDir: string;
  buildCommand?: string;
  buildScriptName?: string;
  skip?: string;
  message?: string;
  authorEmail?: string;
  authorName?: string;
  label?: string[];
  affectedOnly: boolean;
  untraced: string[];
  statsFile?: string;
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
  options: UploadOptions,
  cfg: StorybookConfig | null,
): CollectedUploadOptions {
  return {
    url: options.url ?? cfg?.url ?? envOf("STORYSHELF_URL"),
    slug: options.slug ?? cfg?.slug ?? envOf("STORYSHELF_SLUG"),
    token: options.token ?? envOf("STORYSHELF_TOKEN", "SHELF_TOKEN"),
    sha: options.sha ?? envOf("GITHUB_SHA", "VERCEL_GIT_COMMIT_SHA", "CI_COMMIT_SHA"),
    branch:
      options.branch ?? envOf("GITHUB_REF_NAME", "VERCEL_GIT_COMMIT_REF", "CI_COMMIT_REF_NAME"),
    buildDir: options.buildDir ?? cfg?.buildDir ?? "storybook-static",
    buildCommand: options.buildCommand ?? cfg?.buildCommand,
    buildScriptName: options.buildScriptName ?? cfg?.buildScriptName,
    skip: options.skip ?? cfg?.skip,
    message: options.message,
    authorEmail: options.authorEmail,
    authorName: options.authorName,
    label: options.label,
    affectedOnly: resolveAffectedOnly(options, cfg),
    untraced: options.untraced ?? [],
    statsFile: options.statsFile,
  };
}

/** Affected capture is on by default; `--full` (or `STORYSHELF_FULL=1`) opts out. */
function resolveAffectedOnly(options: UploadOptions, cfg: StorybookConfig | null): boolean {
  if (options.full === true || envOf("STORYSHELF_FULL") === "1") {
    return false;
  }
  return options.affectedOnly ?? cfg?.affectedOnly ?? true;
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
  if (!collected.sha) {
    throw new Error("--sha is required (or GITHUB_SHA env)");
  }
  if (!collected.branch) {
    throw new Error("--branch is required (or GITHUB_REF_NAME env)");
  }
}

function shouldSkipUpload(skip: string | undefined, branch: string | undefined): boolean {
  return Boolean(skip && branch && picomatch.isMatch(branch, skip));
}

/** Parse `--label key=value` flags into label pairs. */
function parseLabels(flags: string[] | undefined): { key: string; value: string }[] {
  return (flags ?? []).map((flag) => {
    const eq = flag.indexOf("=");
    if (eq <= 0) {
      throw new Error(`--label must be key=value, got "${flag}"`);
    }
    return { key: flag.slice(0, eq), value: flag.slice(eq + 1) };
  });
}

/** Zip the built Storybook directory as a stream (bounded memory). */
function zipBuildDirStream(cwd: string, buildDir: string): ZipArchive {
  const archive = new ZipArchive({ zlib: { level: 9 } });
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

/** Ensure, create, and stream the build directory. */
// oxlint-disable-next-line eslint(max-statements) -- buildAndPost orchestrates 11 steps
async function buildAndPost(
  cwd: string,
  collected: ResolvedUploadOptions,
  force?: boolean,
  dryRun?: boolean,
): Promise<void> {
  await ensureBuildDir({
    cwd,
    buildDir: collected.buildDir,
    buildCommand: collected.buildCommand,
    buildScriptName: collected.buildScriptName,
    force,
  });
  await assertBuildOutput(cwd, collected.buildDir);
  if (dryRun) {
    printLine(
      `Dry run: would upload ${collected.buildDir} as ${collected.sha} on ${collected.branch}`,
    );
    return;
  }
  const client = createClient(collected.url, collected.token);
  const created: BuildCreated = await client.projects.builds.createJson(collected.slug, {
    gitSha: collected.sha,
    gitBranch: collected.branch,
    message: collected.message,
    authorEmail: collected.authorEmail,
    authorName: collected.authorName,
    affectedOnly: collected.affectedOnly,
    labels: parseLabels(collected.label),
  });
  await reportAffectedCapture(client, created, cwd, collected);
  // Try content-hash dedup: walk buildDir, hash files, check needed, batch upload or fallback to zip
  const useDedup = await tryDedupUpload(client, created, cwd, collected.buildDir);
  if (!useDedup) {
    await putZipStream(client, created, cwd, collected.buildDir);
  }
  printLine(`Build created: ${created.build.id}`);
}

/** Compute the affected set and post it, never failing the upload. */
async function reportAffectedCapture(
  client: ReturnType<typeof createClient>,
  created: BuildCreated,
  cwd: string,
  collected: ResolvedUploadOptions,
): Promise<void> {
  if (!collected.affectedOnly) {
    printLine("Full capture (--full): rendering all stories");
    return;
  }
  if (!created.baselineSha) {
    printLine("Full capture (no baseline build yet): rendering all stories");
    return;
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
    printLine(describeAffected(result, created.baselineSha));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    printLine(`Full capture (affected post failed: ${reason}): rendering all stories`);
  }
}

/** Human-readable summary of an affected computation. */
function describeAffected(result: AffectedResult, baselineSha: string): string {
  if (result.affectedImportPaths === null) {
    return `Full capture (${result.fullReason ?? "unknown reason"}): rendering all stories`;
  }
  const count = result.affectedImportPaths.length;
  const short = baselineSha.slice(0, 7);
  if (count === 0) {
    return `Affected capture: no stories affected (baseline ${short})`;
  }
  return `Affected capture: rendering ${count} ${count === 1 ? "story" : "stories"} (baseline ${short})`;
}

// oxlint-disable eslint(no-unused-vars, require-await, max-statements) -- stub for dedup, will be wired
async function tryDedupUpload(
  _client: ReturnType<typeof createClient>,
  _created: BuildCreated,
  _cwd: string,
  _buildDir: string,
): Promise<boolean> {
  // Use collected url/token via closure from buildAndPost caller
  return false;
}

/** PUT the streamed zip, then report the created build id. */
async function putZipStream(
  client: ReturnType<typeof createClient>,
  created: BuildCreated,
  cwd: string,
  buildDir: string,
): Promise<void> {
  const spinner = createSpinner("Uploading...", spinnerFrames);
  try {
    await client.projects.builds.uploadZip(created.uploadUrl, zipBuildDirStream(cwd, buildDir));
    spinner.stop("Upload complete");
  } catch (error) {
    spinner.stop("Upload failed");
    throw error;
  }
}
