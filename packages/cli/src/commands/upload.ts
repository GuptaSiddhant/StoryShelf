import { ZipArchive } from "archiver";
import { execSync } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import * as picomatch from "picomatch";
import { createClient, type BuildCreated } from "../client.ts";
import { loadStorybookConfig, type StorybookConfig } from "../config.ts";
import { createSpinner, printLine, spinnerFrames } from "../output.ts";

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
function collectUploadOptions(options: UploadOptions, cfg: StorybookConfig | null): CollectedUploadOptions {
  return {
    url: options.url ?? cfg?.url ?? envOf("STORYSHELF_URL"),
    slug: options.slug ?? cfg?.slug ?? envOf("STORYSHELF_SLUG"),
    token: options.token ?? envOf("STORYSHELF_TOKEN", "SHELF_TOKEN"),
    sha: options.sha ?? envOf("GITHUB_SHA", "VERCEL_GIT_COMMIT_SHA", "CI_COMMIT_SHA"),
    branch: options.branch ?? envOf("GITHUB_REF_NAME", "VERCEL_GIT_COMMIT_REF", "CI_COMMIT_REF_NAME"),
    buildDir: options.buildDir ?? cfg?.buildDir ?? "storybook-static",
    buildCommand: options.buildCommand ?? cfg?.buildCommand,
    buildScriptName: options.buildScriptName ?? cfg?.buildScriptName,
    skip: options.skip ?? cfg?.skip,
    message: options.message,
    authorEmail: options.authorEmail,
    authorName: options.authorName,
    label: options.label,
  };
}

interface ResolvedUploadOptions extends CollectedUploadOptions {
  url: string;
  slug: string;
  token: string;
  sha: string;
  branch: string;
}

/** Throw on the first missing required upload option. */
function assertUploadOptions(collected: CollectedUploadOptions): asserts collected is ResolvedUploadOptions {
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
  await buildAndPost(cwd, collected, options.forceBuild);
}

/** Ensure, create, and stream the build directory. */
async function buildAndPost(
  cwd: string,
  collected: ResolvedUploadOptions,
  force?: boolean,
): Promise<void> {
  await ensureBuildDir({
    cwd,
    buildDir: collected.buildDir,
    buildCommand: collected.buildCommand,
    buildScriptName: collected.buildScriptName,
    force,
  });
  const client = createClient(collected.url, collected.token);
  const created: BuildCreated = await client.projects.builds.createJson(collected.slug, {
    gitSha: collected.sha,
    gitBranch: collected.branch,
    message: collected.message,
    authorEmail: collected.authorEmail,
    authorName: collected.authorName,
    labels: parseLabels(collected.label),
  });
  await putZipStream(client, created, cwd, collected.buildDir);
  printLine(`Build created: ${created.build.id}`);
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

async function ensureBuildDir(opts: {
  cwd: string;
  buildDir: string;
  buildCommand?: string;
  buildScriptName?: string;
  force?: boolean;
}): Promise<void> {
  if (opts.buildCommand && opts.buildScriptName) {
    throw new Error("buildCommand and buildScriptName are mutually exclusive");
  }
  const full = resolve(opts.cwd, opts.buildDir);
  const shouldBuild = opts.force ?? (await needsBuild(full));
  if (!shouldBuild) {
    return;
  }
  const command =
    opts.buildCommand ??
    `npm run ${opts.buildScriptName ?? "build-storybook"} -- --output-dir ${opts.buildDir}`;
  printLine(`Building Storybook: ${command}`);
  execSync(command, {
    stdio: "inherit",
    env: { ...process.env, STORYBOOK_BUILD_STORIES_JSON: "true" },
  });
}

/** True when the build directory is missing or empty. */
async function needsBuild(full: string): Promise<boolean> {
  try {
    await access(full);
    const entries = await readdir(full);
    return entries.length === 0;
  } catch {
    return true;
  }
}
