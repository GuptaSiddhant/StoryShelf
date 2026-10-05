import type { Command } from "commander";
import { loadStorybookConfig, type StorybookConfig } from "../config.ts";
import { printError } from "../output.ts";
import { runUpload } from "./upload.ts";

/** Print an error and mark the process as failed. */
export function handleError(error: unknown): void {
  printError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

interface DefaultUploadOptions {
  url: string;
  slug: string;
  token: string;
  sha: string;
  branch: string;
  buildDir: string;
  buildCommand?: string;
  buildScriptName?: string;
  skip?: string;
}

function defaultUploadOptions(cfg: StorybookConfig | null): DefaultUploadOptions | null {
  const url = cfg?.url ?? process.env["STORYSHELF_URL"];
  const slug = cfg?.slug;
  const token = process.env["STORYSHELF_TOKEN"] ?? process.env["SHELF_TOKEN"];
  const sha =
    process.env["GITHUB_SHA"] ??
    process.env["VERCEL_GIT_COMMIT_SHA"] ??
    process.env["CI_COMMIT_SHA"];
  const branch =
    process.env["GITHUB_REF_NAME"] ??
    process.env["VERCEL_GIT_COMMIT_REF"] ??
    process.env["CI_COMMIT_REF_NAME"];
  if (!url || !slug || !token || !sha || !branch) {
    return null;
  }
  return {
    url,
    slug,
    token,
    sha,
    branch,
    buildDir: cfg?.buildDir ?? "storybook-static",
    buildCommand: cfg?.buildCommand,
    buildScriptName: cfg?.buildScriptName,
    skip: cfg?.skip,
  };
}

/**
 * Default behavior for bare `storyshelf` (no subcommand): upload when a
 * client config exists, otherwise point at init.
 */
export async function runDefaultCommand(program: Command): Promise<void> {
  const cfg = await loadStorybookConfig();
  const options = defaultUploadOptions(cfg);
  if (!options) {
    program.outputHelp();
    if (cfg) {
      printError(
        "Missing required upload options — ensure STORYSHELF_URL/SLUG/TOKEN and GITHUB_SHA/BRANCH are set or run `storyshelf upload --help`",
      );
    } else {
      printError(
        "No .storybook/storyshelf.json found — run `storyshelf init --url <url> --slug <slug>` first",
      );
    }
    process.exitCode = 1;
    return;
  }
  await runUpload(options).catch(handleError);
}
