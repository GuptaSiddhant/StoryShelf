import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Answers } from "./init/answers.ts";
import { isCloud, runCloudInit } from "./init/cloud.ts";
import { printNextSteps } from "./init/next-steps.ts";
import { collectAnswers, defaultAnswers } from "./init/prompts.ts";
import { writeFiles } from "./init/writers.ts";
import { runInstall } from "./install.ts";
import { createReporter, printError } from "./output.ts";
import { detectPackageRunner, installCommand, type PackageRunner } from "./runner.ts";

/**
 * Options for `create-storyshelf` — scaffolds a new StoryShelf server project.
 */
export interface InitOptions {
  /** Output directory for the generated server (defaults to `storyshelf-server`). */
  dir?: string;
  /** `aws`, `gcp` or `azure`: write a Terraform module stub instead of scaffolding a server. */
  cloud?: string;
  /** Run the package manager's install in the new project (opt in; never with `--cloud`). */
  install?: boolean;
  /** Accept every default without prompting (`--yes`); needs no terminal. */
  yes?: boolean;
}

const NO_TERMINAL =
  "create-storyshelf asks questions and needs an interactive terminal; nothing was written. Run it in a terminal, or pass --yes to accept the defaults.";

/** Input ended mid-question: say why, and leave exit code 1 for when Node finds nothing left to run. */
function onInputEnd(): void {
  printError(NO_TERMINAL);
  process.exitCode = 1;
}

/**
 * Ask the questions. Input that ends before they are answered (no terminal, `< /dev/null`) would
 * leave the prompt pending and Node would exit 0 having written nothing: fail with the reason instead.
 */
async function collectAnswersOrFail(dir?: string, yes = false): Promise<Answers | null> {
  if (yes) return defaultAnswers(dir);
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
 * then generates `src/index.ts`, `package.json`, and optional Docker files in
 * the chosen directory.
 *
 * With `--cloud` it writes a Terraform module stub for that cloud instead.
 *
 * @param options - `dir` skips the directory question (every other choice is asked interactively);
 *   `yes` asks nothing and takes every default;
 *   `cloud` selects the Terraform stub
 */
export async function runInit(options: InitOptions, deps: InitDeps = {}): Promise<void> {
  if (options.cloud !== undefined) {
    await initCloud(options.cloud, options.dir);
    return;
  }
  await scaffoldServer(options.dir, options.install === true, options.yes === true, deps);
}

/** What `runInit` calls out to; tests replace it. */
export interface InitDeps {
  /** Run the install in the new project (default: the package manager that ran `create-storyshelf`). */
  install?: (outDir: string, runner: PackageRunner) => Promise<number>;
}

/** Ask the questions, then write the server files and print the next steps. */
async function scaffoldServer(
  dir: string | undefined,
  install: boolean,
  yes: boolean,
  deps: InitDeps,
): Promise<void> {
  const answers = await collectAnswersOrFail(dir, yes);
  if (answers === null) {
    process.exitCode = 1;
    return;
  }

  const outDir = resolve(answers.dir);
  await createReporter().phase("Writing server project", "Wrote server project", async () => {
    await mkdir(outDir, { recursive: true });
    await writeFiles(outDir, answers);
  });
  const runner = await detectPackageRunner(process.cwd());
  const installed = install && (await installIn(outDir, runner, deps)) === 0;
  printNextSteps(answers, runner, installed);
}

/** Install in `outDir` (opt-in): a failed install is reported and left for the person to retry. */
async function installIn(outDir: string, runner: PackageRunner, deps: InitDeps): Promise<number> {
  const run = deps.install ?? runInstall;
  const code = await run(outDir, runner);
  if (code !== 0) {
    printError(`${installCommand(runner)} failed (exit ${code}); run it in ${outDir} to retry.`);
  }
  return code;
}

async function initCloud(cloud: string, dir: string | undefined): Promise<void> {
  if (!isCloud(cloud)) {
    throw new Error(`Unknown --cloud "${cloud}"; use aws, gcp or azure.`);
  }
  await runCloudInit(cloud, dir);
}
