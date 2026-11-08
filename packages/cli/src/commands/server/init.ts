import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { detectPackageRunner } from "../../config.ts";
import { printNextSteps } from "./init/next-steps.ts";
import { collectAnswers } from "./init/prompts.ts";
import { writeFiles } from "./init/writers.ts";

/**
 * Options for `storyshelf server init` — scaffolds a new StoryShelf server project.
 */
export interface ServerInitOptions {
  /** Output directory for the generated server (defaults to `storyshelf-server`). */
  dir?: string;
}

/**
 * Scaffold a new StoryShelf server project via interactive prompts.
 *
 * Asks for project name, database, storage, auth, and git provider choices,
 * then generates `server.ts`, `package.json`, and optional Docker files in
 * the chosen directory.
 *
 * @param _options - Reserved for future CLI flags; currently prompts for all choices interactively
 */
export async function runServerInit(_options: ServerInitOptions): Promise<void> {
  const answers = await collectAnswers();
  if (answers === null) {
    return;
  }

  const outDir = resolve(answers.dir);
  await mkdir(outDir, { recursive: true });

  await writeFiles(outDir, answers);
  printNextSteps(answers, await detectPackageRunner(process.cwd()));
}
