import { Command } from "commander";
import { pathToFileURL } from "node:url";

import { runCreate, type CreateOptions } from "./commands/create/index.ts";
import { runInit, type InitOptions } from "./commands/init.ts";
import { runPurge, type PurgeOptions } from "./commands/purge.ts";
import { runRetry, type RetryOptions } from "./commands/retry.ts";
import { runUpload, type UploadOptions } from "./commands/upload.ts";
import { printError } from "./output.ts";

function handleError(error: unknown): void {
  printError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function run<TArgs>(fn: (args: TArgs) => Promise<void>): (args: TArgs) => Promise<void> {
  return async (args: TArgs) => {
    await fn(args).catch(handleError);
  };
}

/**
 * Build the StoryShelf CLI program with all subcommands registered.
 *
 * @returns The configured commander Command instance.
 */
export function createProgram(): Command {
  const program = new Command();
  program.name("storyshelf").description("Self-hosted visual testing for Storybook.").version("0.1.0");

  program
    .command("create")
    .description("Scaffold a new StoryShelf server project")
    .option("--dir <dir>", "output directory")
    .action(run<CreateOptions>(runCreate));

  program
    .command("init")
    .description("Create a project and CI token on a StoryShelf server")
    .requiredOption("--url <url>", "server base URL")
    .requiredOption("--name <name>", "project name")
    .action(run<InitOptions>(runInit));

  program
    .command("purge")
    .description("Purge expired builds on a StoryShelf server")
    .requiredOption("--url <url>", "server base URL")
    .action(run<PurgeOptions>(runPurge));

  program
    .command("upload")
    .description("Create a build record for a StoryShelf project")
    .requiredOption("--url <url>", "server base URL")
    .requiredOption("--slug <slug>", "project slug")
    .requiredOption("--token <token>", "CI token")
    .requiredOption("--sha <sha>", "git sha")
    .requiredOption("--branch <branch>", "git branch")
    .option("--storybook-dir <dir>", "built Storybook directory", "storybook-static")
    .option("--message <message>", "commit message")
    .option("--author-email <email>", "author email")
    .option("--author-name <name>", "author name")
    .action(run<UploadOptions>(runUpload));

  program
    .command("retry")
    .description("Retry a failed StoryShelf build")
    .requiredOption("--url <url>", "server base URL")
    .requiredOption("--slug <slug>", "project slug")
    .requiredOption("--build-id <id>", "build id")
    .action(run<RetryOptions>(runRetry));

  return program;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createProgram().parse(process.argv);
}
