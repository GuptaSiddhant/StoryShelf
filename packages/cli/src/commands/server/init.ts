import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { detectPackageRunner } from "../../config.ts";
import { printError } from "../../output.ts";
import type { Answers } from "./init/answers.ts";
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

const NO_TERMINAL =
  "server init asks questions and needs an interactive terminal; nothing was written. Run it in a terminal.";

/** Input ended mid-question: say why, and leave exit code 1 for when Node finds nothing left to run. */
function onInputEnd(): void {
  printError(NO_TERMINAL);
  process.exitCode = 1;
}

/**
 * Ask the questions. Input that ends before they are answered (no terminal, `< /dev/null`) would
 * leave the prompt pending and Node would exit 0 having written nothing: fail with the reason instead.
 */
async function collectAnswersOrFail(dir?: string): Promise<Answers | null> {
  process.stdin.once("end", onInputEnd);
  try {
    const answers = await collectAnswers(dir);
    if (answers === null && !process.stdin.isTTY) {
      printError(NO_TERMINAL);
    }
    return answers;
  } finally {
    process.stdin.removeListener("end", onInputEnd);
  }
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
 * @param options - `dir` skips the directory question (every other choice is asked interactively);
 *   `cloud` selects the Terraform stub
 */
export async function runServerInit(options: ServerInitOptions): Promise<void> {
  if (options.cloud !== undefined) {
    await initCloud(options.cloud, options.dir);
    return;
  }
  await scaffoldServer(options.dir);
}

/** Ask the questions, then write the server files and print the next steps. */
async function scaffoldServer(dir: string | undefined): Promise<void> {
  const answers = await collectAnswersOrFail(dir);
  if (answers === null) {
    process.exitCode = 1;
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
