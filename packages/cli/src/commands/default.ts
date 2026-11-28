import { loadStorybookConfig } from "../config.ts";
import { monorepoHint } from "../config/workspace.ts";
import { printError } from "../output.ts";
import { runUpload, type UploadOptions } from "./upload.ts";

/** Print an error and mark the process as failed. */
export function handleError(error: unknown): void {
  printError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

/**
 * Default behavior for bare `storyshelf` (no subcommand): `storyshelf upload` with no flags when a
 * client config exists, otherwise a short pointer at init (or at the workspace package that holds
 * the Storybook). It resolves nothing itself: the connection, the commit and branch, the token
 * warning, the shallow-clone warning and the missing-value errors are `runUpload`'s, so the two
 * commands cannot drift apart. The full help is `storyshelf --help`, not printed here.
 *
 * @param options - Test seam: working directory, dry run and the other `upload` options.
 */
export async function runDefaultCommand(options: UploadOptions = {}): Promise<void> {
  try {
    if ((await loadStorybookConfig(options.cwd, options.config)) === null) {
      printError(await missingConfigMessage(options.cwd ?? process.cwd()));
      process.exitCode = 1;
      return;
    }
    await runUpload(options);
  } catch (error) {
    handleError(error);
  }
}

/** One short line: init, or the workspace package that holds the Storybook when the root has none. */
async function missingConfigMessage(cwd: string): Promise<string> {
  const hint = await monorepoHint(cwd);
  if (hint) {
    return `No .storybook/storyshelf.json at this root. ${hint}`;
  }
  return "No .storybook/storyshelf.json found — run `storyshelf init --url <url> --slug <slug>` first";
}
