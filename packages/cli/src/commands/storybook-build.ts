import { execSync } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { detectPackageRunner, type PackageRunner } from "../config.ts";
import { printLine } from "../output.ts";

/** Options for ensuring a built Storybook directory exists. */
export interface EnsureBuildDirOptions {
  cwd: string;
  buildDir: string;
  buildCommand?: string;
  buildScriptName?: string;
  force?: boolean;
}

/**
 * Script invocation per runner. npm needs `--` to forward args; pnpm, bun,
 * yarn, deno, and nub append trailing args to the script directly (a literal
 * `--` would be forwarded as a positional and can break the build).
 */
function scriptCommand(runner: PackageRunner, scriptName: string, buildDir: string): string {
  const args = `--output-dir ${buildDir}`;
  if (runner === "npm") {
    return `npm run ${scriptName} -- ${args}`;
  }
  if (runner === "deno") {
    return `deno task ${scriptName} ${args}`;
  }
  if (runner === "yarn") {
    return `yarn ${scriptName} ${args}`;
  }
  return `${runner} run ${scriptName} ${args}`;
}

/** Resolve the shell command that builds the Storybook directory. */
export async function resolveBuildCommand(
  cwd: string,
  buildDir: string,
  buildCommand?: string,
  buildScriptName?: string,
): Promise<string> {
  if (buildCommand) {
    return buildCommand;
  }
  const runner = await detectPackageRunner(cwd);
  return scriptCommand(runner, buildScriptName ?? "build-storybook", buildDir);
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
  const command = await resolveBuildCommand(
    opts.cwd,
    opts.buildDir,
    opts.buildCommand,
    opts.buildScriptName,
  );
  printLine(`Building Storybook: ${command}`);
  execSync(command, {
    stdio: "inherit",
    env: { ...process.env, STORYBOOK_BUILD_STORIES_JSON: "true" },
  });
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
