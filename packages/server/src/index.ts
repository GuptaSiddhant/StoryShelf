import { Command } from "commander";
import { pathToFileURL } from "node:url";

import { runServe, type ServeOptions } from "./commands/serve.ts";

function printError(message: string): void {
  process.stderr.write(`${message}\n`);
}

function run<TArgs>(fn: (args: TArgs) => Promise<void>): (args: TArgs) => Promise<void> {
  return async (args: TArgs) => {
    await fn(args).catch((error: unknown) => {
      printError(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  };
}

/**
 * Build the StoryShelf server program.
 *
 * @returns The configured commander Command instance.
 */
export function createProgram(): Command {
  const program = new Command();
  program
    .name("storyshelf-server")
    .description("Self-hosted visual testing for Storybook.")
    .version("0.1.0");

  program
    .command("serve", { isDefault: true })
    .description("Start the StoryShelf server")
    .option("-p, --port <port>", "port to listen on", "3000")
    .option("--data-dir <dir>", "data directory", "./data")
    .option("--secret <secret>", "session secret")
    .option("--capture-concurrency <n>", "concurrent capture jobs", "2")
    .option("--purge-ttl-days <n>", "purge builds older than N days", "30")
    .action(run<ServeOptions>(runServe));

  return program;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createProgram().parse(process.argv);
}