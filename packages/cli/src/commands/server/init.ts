import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { detectPackageRunner } from "../../config.ts";
import { isCloud, runCloudInit } from "./init/cloud.ts";
import { printNextSteps } from "./init/next-steps.ts";
import { collectAnswers } from "./init/prompts.ts";
import { writeFiles } from "./init/writers.ts";

/**
 * Options for `storyshelf server init` — scaffolds a new StoryShelf server project.
 */
export interface ServerInitOptions {
  /** Output directory for the generated server (defaults to `storyshelf-server`). */
  dir?: string;
  /** `aws`, `gcp` or `azure`: write a Terraform module stub instead of scaffolding a server. */
  cloud?: string;
}

/**
 * Scaffold a new StoryShelf server project via interactive prompts.
 *
 * Asks for project name, database, storage, auth, and git provider choices,
 * then generates `server.ts`, `package.json`, and optional Docker files in
 * the chosen directory.
 *
 * With `--cloud` it writes a Terraform module stub for that cloud instead.
 *
 * @param options - `dir` presets the output directory; `cloud` selects the Terraform stub
 */
export async function runServerInit(options: ServerInitOptions): Promise<void> {
  if (options.cloud !== undefined) {
    return await initCloud(options.cloud, options.dir);
  }
  const answers = await collectAnswers();
  if (answers === null) {
    return;
  }

  const outDir = resolve(answers.dir);
  await mkdir(outDir, { recursive: true });

  await writeFiles(outDir, answers);
  printNextSteps(answers, await detectPackageRunner(process.cwd()));
}

async function initCloud(cloud: string, dir: string | undefined): Promise<void> {
  if (!isCloud(cloud)) {
    throw new Error(`Unknown --cloud "${cloud}"; use aws, gcp or azure.`);
  }
  await runCloudInit(cloud, dir);
}
