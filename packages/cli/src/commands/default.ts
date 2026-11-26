import type { Command } from "commander";
import { loadStorybookConfig, type StorybookConfig } from "../config.ts";
import { printError } from "../output.ts";
import { readSetting } from "../settings.ts";
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
  buildDir: string;
  buildCommand?: string;
  buildScriptName?: string;
  skip?: string;
}

/**
 * The connection and build settings of a bare `storyshelf`. The commit and branch are not read
 * here: `runUpload` resolves them (flags, CI provider, local git, then a synthesized identity).
 */
function defaultUploadOptions(cfg: StorybookConfig | null): DefaultUploadOptions | null {
  const url = readSetting(process.env, "SHELF_URL") ?? cfg?.url;
  const slug = readSetting(process.env, "SHELF_SLUG") ?? cfg?.slug;
  const token = readSetting(process.env, "SHELF_TOKEN");
  if (!url || !slug || !token) {
    return null;
  }
  return {
    url,
    slug,
    token,
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
        "Missing required upload options — ensure SHELF_TOKEN is set, and the url and slug come from .storybook/storyshelf.json or SHELF_URL/SHELF_SLUG, or run `storyshelf upload --help`",
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
