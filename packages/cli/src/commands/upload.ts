import AdmZip from "adm-zip";
import { execSync } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import * as picomatch from "picomatch";
import { createClient } from "../client.ts";
import { loadStorybookConfig, type StorybookConfig } from "../config.ts";
import { createSpinner, printLine, spinnerFrames } from "../output.ts";

interface BuildResponse {
  id: string;
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
  /** Deprecated alias for buildDir. */
  storybookDir?: string;
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
    buildDir: options.buildDir ?? options.storybookDir ?? cfg?.buildDir ?? "storybook-static",
    buildCommand: options.buildCommand ?? cfg?.buildCommand,
    buildScriptName: options.buildScriptName ?? cfg?.buildScriptName,
    skip: options.skip ?? cfg?.skip,
    message: options.message,
    authorEmail: options.authorEmail,
    authorName: options.authorName,
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

/** Zip the built Storybook directory into a buffer. */
function zipBuildDir(cwd: string, buildDir: string): Buffer {
  const zip = new AdmZip();
  zip.addLocalFolder(resolve(cwd, buildDir));
  return zip.toBuffer();
}

function setAuthorFields(form: FormData, opts: ResolvedUploadOptions): void {
  if (opts.message) {
    form.set("message", opts.message);
  }
  if (opts.authorEmail) {
    form.set("authorEmail", opts.authorEmail);
  }
  if (opts.authorName) {
    form.set("authorName", opts.authorName);
  }
}

/** Build the multipart upload form for a zipped Storybook. */
function buildUploadForm(buffer: Buffer, opts: ResolvedUploadOptions): FormData {
  const form = new FormData();
  form.set("gitSha", opts.sha);
  form.set("gitBranch", opts.branch);
  setAuthorFields(form, opts);
  form.set(
    "zip",
    new Blob([new Uint8Array(buffer)], { type: "application/zip" }),
    "storybook.zip",
  );
  return form;
}

/** Post the form and return the created build id, with spinner handling. */
async function postBuild(
  client: ReturnType<typeof createClient>,
  slug: string,
  form: FormData,
): Promise<string> {
  const spinner = createSpinner("Uploading...", spinnerFrames);
  try {
    const build = (await client.projects.builds.create(slug, form)) as BuildResponse;
    spinner.stop("Upload complete");
    return build.id;
  } catch (error) {
    spinner.stop("Upload failed");
    throw error;
  }
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

/** Ensure, zip, and post the build directory. */
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
  const buffer = zipBuildDir(cwd, collected.buildDir);
  const form = buildUploadForm(buffer, collected);
  const client = createClient(collected.url, collected.token);
  await executeUpload(client, collected.slug, form);
}

/** Post the build form and report the created build id. */
async function executeUpload(
  client: ReturnType<typeof createClient>,
  slug: string,
  form: FormData,
): Promise<void> {
  const buildId = await postBuild(client, slug, form);
  printLine(`Build created: ${buildId}`);
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
