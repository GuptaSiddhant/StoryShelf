import type { Command } from "commander";
import { loadStorybookConfig } from "../config.ts";
import { printError } from "../output.ts";
import { runUpload, type UploadOptions } from "./upload.ts";

/** Print an error and mark the process as failed. */
export function handleError(error: unknown): void {
  printError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

/**
 * Default behavior for bare `storyshelf` (no subcommand): `storyshelf upload` with no flags when a
 * client config exists, otherwise point at init. It resolves nothing itself: the connection, the
 * commit and branch, the token warning, the shallow-clone warning and the missing-value errors are
 * `runUpload`'s, so the two commands cannot drift apart.
 *
 * @param program - The CLI, for its help text.
 * @param options - Test seam: working directory, dry run and the other `upload` options.
 */
export async function runDefaultCommand(
  program: Command,
  options: UploadOptions = {},
): Promise<void> {
  try {
    if ((await loadStorybookConfig(options.cwd, options.config)) === null) {
      program.outputHelp();
      printError(
        "No .storybook/storyshelf.json found — run `storyshelf init --url <url> --slug <slug>` first",
      );
      process.exitCode = 1;
      return;
    }
    await runUpload(options);
  } catch (error) {
    handleError(error);
  }
}
