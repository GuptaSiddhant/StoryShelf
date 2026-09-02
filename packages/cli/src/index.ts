/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, max-statements, max-lines-per-function, complexity, eslint/no-await-in-loop, unicorn/prefer-top-level-await, typescript/no-floating-promises, typescript/explicit-function-return-type */
import { Command } from "commander";
import { pathToFileURL } from "node:url";

import { loadStorybookConfig } from "./config.ts";
import { runCreate, type CreateOptions } from "./commands/create.ts";
import { runInit, type InitOptions } from "./commands/init.ts";
import { runPurge, type PurgeOptions } from "./commands/purge.ts";
import { runRetry, type RetryOptions } from "./commands/retry.ts";
import { runUpload, type UploadOptions } from "./commands/upload.ts";
import { runServerInit, type ServerInitOptions } from "./commands/server/init.ts";
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
    .command("init")
    .description("Initialize Storybook project with .storybook/storyshelf.json (client config)")
    .option("--url <url>", "server base URL")
    .option("--slug <slug>", "project slug")
    .option("--storybook-dir <dir>", "built Storybook directory")
    .option("--token <token>", "auth token for sync (or STORYSHELF_TOKEN/STORYSHELF_ADMIN_TOKEN env)")
    .action(run<InitOptions>(runInit));

  program
    .command("create")
    .description("Create a project on StoryShelf server (requires admin token)")
    .option("--url <url>", "server base URL")
    .option("--name <name>", "project name")
    .option("--token <token>", "admin token (or STORYSHELF_ADMIN_TOKEN env)")
    .action(run<CreateOptions>(runCreate));

  const server = program.command("server").description("Server operations");
  server
    .command("init")
    .description("Scaffold a new StoryShelf server project")
    .option("--dir <dir>", "output directory")
    .action(run<ServerInitOptions>(runServerInit));

  program
    .command("purge")
    .description("Purge expired builds on a StoryShelf server")
    .requiredOption("--url <url>", "server base URL")
    .option("--token <token>", "admin token (or STORYSHELF_ADMIN_TOKEN env)")
    .action(run<PurgeOptions>(runPurge));

  program
    .command("upload")
    .description("Create a build record for a StoryShelf project")
    .option("--url <url>", "server base URL (or .storybook/storyshelf.json)")
    .option("--slug <slug>", "project slug (or .storybook/storyshelf.json)")
    .option("--token <token>", "CI token (or STORYSHELF_TOKEN env)")
    .option("--sha <sha>", "git sha (or GITHUB_SHA env)")
    .option("--branch <branch>", "git branch (or GITHUB_REF_NAME env)")
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
    .option("--token <token>", "CI token (or STORYSHELF_TOKEN env)")
    .action(run<RetryOptions>(runRetry));

  return program;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const program = createProgram();
  // Default: `storyshelf` with no args -> upload if config exists, else help to init
  if (process.argv.length <= 2) {
    (async () => {
      const cfg = await loadStorybookConfig();
      if (cfg) {
        const url = cfg.url ?? process.env["STORYSHELF_URL"];
        const slug = cfg.slug;
        const token = process.env["STORYSHELF_TOKEN"] ?? process.env["SHELF_TOKEN"];
        const sha = process.env["GITHUB_SHA"] ?? process.env["VERCEL_GIT_COMMIT_SHA"] ?? process.env["CI_COMMIT_SHA"];
        const branch = process.env["GITHUB_REF_NAME"] ?? process.env["VERCEL_GIT_COMMIT_REF"] ?? process.env["CI_COMMIT_REF_NAME"];
        const storybookDir = cfg.storybookDir ?? "storybook-static";
        if (!url || !slug || !token || !sha || !branch) {
          printError("Missing required upload options — ensure STORYSHELF_URL/SLUG/TOKEN and GITHUB_SHA/BRANCH are set or run `storyshelf upload --help`");
          program.outputHelp();
          process.exitCode = 1;
          return;
        }
        await runUpload({ url, slug, token, sha, branch, storybookDir }).catch(handleError);
      } else {
        program.outputHelp();
        printError("No .storybook/storyshelf.json found — run `storyshelf init --url <url> --slug <slug>` first");
        process.exitCode = 1;
      }
    })();
  } else {
    program.parse(process.argv);
  }
}
