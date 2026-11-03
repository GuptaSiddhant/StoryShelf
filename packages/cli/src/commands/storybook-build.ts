import { execSync } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { detectPackageRunner, type PackageRunner } from "../config.ts";
import { printError, printLine } from "../output.ts";

/** Options for ensuring a built Storybook directory exists. */
export interface EnsureBuildDirOptions {
  cwd: string;
  buildDir: string;
  buildCommand?: string;
  buildScriptName?: string;
  force?: boolean;
  /** Affected capture is on: the build should leave `preview-stats.json` for tracing. */
  affected?: boolean;
  /** Add `--stats-json` to the build script when affected capture is on (default true). */
  buildStats?: boolean;
  /** Stats file the upload will read (default `<buildDir>/preview-stats.json`). */
  statsFile?: string;
}

/**
 * Script invocation per runner. npm needs `--` to forward args; pnpm, bun,
 * yarn, and nub append trailing args to the script directly (a literal
 * `--` would be forwarded as a positional and can break the build).
 */
function scriptCommand(
  runner: PackageRunner,
  scriptName: string,
  buildDir: string,
  stats: boolean,
): string {
  const args = `--output-dir ${buildDir}${stats ? " --stats-json" : ""}`;
  if (runner === "npm") {
    return `npm run ${scriptName} -- ${args}`;
  }
  if (runner === "yarn") {
    return `yarn ${scriptName} ${args}`;
  }
  return `${runner} run ${scriptName} ${args}`;
}

/**
 * Resolve the shell command that builds the Storybook directory. `stats` appends `--stats-json`
 * to the build script; a custom `buildCommand` is the user's and is never modified.
 */
export async function resolveBuildCommand(
  cwd: string,
  buildDir: string,
  buildCommand?: string,
  buildScriptName?: string,
  stats = false,
): Promise<string> {
  if (buildCommand) {
    return buildCommand;
  }
  const runner = await detectPackageRunner(cwd);
  return scriptCommand(runner, buildScriptName ?? "build-storybook", buildDir, stats);
}

/** Build the Storybook directory when missing, empty, or forced. */
export async function ensureBuildDir(opts: EnsureBuildDirOptions): Promise<void> {
  if (opts.buildCommand && opts.buildScriptName) {
    throw new Error("buildCommand and buildScriptName are mutually exclusive");
  }
  const full = resolve(opts.cwd, opts.buildDir);
  const shouldBuild = opts.force ?? (await needsBuild(full));
  if (!shouldBuild) {
    return;
  }
  const command = await commandFor(opts);
  printLine(`Building Storybook: ${command}`);
  execSync(command, {
    stdio: "inherit",
    env: { ...process.env, STORYBOOK_BUILD_STORIES_JSON: "true" },
  });
  await warnWithoutStats(opts);
}

/** The build command for these options; stats are asked for only when affected capture needs them. */
async function commandFor(opts: EnsureBuildDirOptions): Promise<string> {
  const stats = opts.affected === true && opts.buildStats !== false;
  return await resolveBuildCommand(
    opts.cwd,
    opts.buildDir,
    opts.buildCommand,
    opts.buildScriptName,
    stats,
  );
}

/** One warning when a build leaves no stats file: affected capture will render every story. */
async function warnWithoutStats(opts: EnsureBuildDirOptions): Promise<void> {
  if (opts.affected !== true) {
    return;
  }
  const stats = resolve(opts.cwd, opts.statsFile ?? join(opts.buildDir, "preview-stats.json"));
  try {
    await access(stats);
  } catch {
    printError(
      `Warning: the build wrote no ${stats}, so affected capture will render every story. Add --stats-json to the build command (storybook build --stats-json) or point statsFile at an existing stats file.`,
    );
  }
}

/** True when the build directory is missing or empty. */
export async function needsBuild(full: string): Promise<boolean> {
  try {
    await access(full);
    const entries = await readdir(full);
    return entries.length === 0;
  } catch {
    return true;
  }
}

/** Fail fast when the build output lacks the Storybook index. */
export async function assertBuildOutput(cwd: string, buildDir: string): Promise<void> {
  const index = resolve(cwd, buildDir, "index.json");
  try {
    await access(index);
  } catch {
    throw new Error(
      `Build output incomplete: ${index} not found — check --build-dir and the build command output`,
    );
  }
}
