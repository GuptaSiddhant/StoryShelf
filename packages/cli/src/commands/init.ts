/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, max-statements, max-lines-per-function, complexity */
import prompts from "prompts";

import { assertStorybookMain, loadStorybookConfig, writeStorybookConfig } from "../config.ts";
import { printError, printLine } from "../output.ts";

/** Options for the `init` command (client config). */
export interface InitOptions {
  /** Server base URL. */
  url?: string;
  /** Project slug. */
  slug?: string;
  /** Built Storybook directory for config. */
  storybookDir?: string;
}

/**
 * Initialize .storybook/storyshelf.json for the current Storybook.
 * Fails if .storybook/main.* is not found.
 *
 * @param options - Init command options.
 */
export async function runInit(options: InitOptions): Promise<void> {
  await assertStorybookMain();

  let url = options.url ?? process.env["STORYSHELF_URL"];
  let slug = options.slug ?? process.env["STORYSHELF_SLUG"];
  let storybookDir = options.storybookDir;

  const existing = await loadStorybookConfig();
  if (existing) {
    url ??= existing.url;
    slug ??= existing.slug;
    storybookDir ??= existing.storybookDir;
  }

  const questions: Array<{ type: "text"; name: string; message: string; initial?: string }> = [];
  if (!url) {
    questions.push({ type: "text", name: "url", message: "Server URL?" });
  }
  if (!slug) {
    questions.push({ type: "text", name: "slug", message: "Project slug?" });
  }

  if (questions.length > 0) {
    const answers = await prompts(questions);
    if (questions.some((q) => !answers[q.name])) {
      printError("Cancelled.");
      return;
    }
    url ??= answers["url"] as string | undefined;
    slug ??= answers["slug"] as string | undefined;
  }

  if (!slug) {
    printError("--slug is required (or run `storyshelf create --url <url> --name <name>`)");
    process.exitCode = 1;
    return;
  }

  const config: { slug: string; url?: string; storybookDir?: string } = { slug };
  if (url) config.url = url;
  if (storybookDir) config.storybookDir = storybookDir;

  try {
    const written = await writeStorybookConfig(config);
    printLine(`Wrote ${written}`);
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
