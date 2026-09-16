import { resolve } from "node:path";
import { loadStorybookConfig } from "../config.ts";
import { printLine } from "../output.ts";
import { assertBuildOutput, ensureBuildDir } from "./storybook-build.ts";

/** Options for the `build` command. */
export interface BuildOptions {
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
  /** Working directory (defaults to process.cwd()). Test seam for fs access. */
  cwd?: string;
}

/**
 * Build a Storybook directory without uploading, using the same
 * buildDir/buildCommand/buildScriptName resolution as `upload`.
 *
 * @param options - Build command options.
 */
export async function runBuild(options: BuildOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const cfg = await loadStorybookConfig(cwd, options.config);
  const buildDir = options.buildDir ?? cfg?.buildDir ?? "storybook-static";
  await ensureBuildDir({
    cwd,
    buildDir,
    buildCommand: options.buildCommand ?? cfg?.buildCommand,
    buildScriptName: options.buildScriptName ?? cfg?.buildScriptName,
    force: options.forceBuild,
  });
  await assertBuildOutput(cwd, buildDir);
  printLine(`Build ready: ${resolve(cwd, buildDir)}`);
}
