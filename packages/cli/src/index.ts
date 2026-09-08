import { Command } from "commander";
import { pathToFileURL } from "node:url";
import { runBuild, type BuildOptions } from "./commands/build.ts";
import type { ConnectionOptions } from "./commands/connection.ts";
import { runCreate, type CreateOptions } from "./commands/create.ts";
import { runDefaultCommand, handleError } from "./commands/default.ts";
import { runDoctor, type DoctorOptions } from "./commands/doctor.ts";
import { runInit, type InitOptions } from "./commands/init.ts";
import { runPurge, type PurgeOptions } from "./commands/purge.ts";
import { runRetry, type RetryOptions } from "./commands/retry.ts";
import { runServerInit, type ServerInitOptions } from "./commands/server/init.ts";
import { runServerServe, type ServerServeOptions } from "./commands/server/serve.ts";
import { runUpload, type UploadOptions } from "./commands/upload.ts";
import { runWhoami } from "./commands/whoami.ts";

/**
 * Build the StoryShelf CLI program with all subcommands registered.
 *
 * @returns The configured commander Command instance.
 */
export function createProgram(): Command {
  const program = new Command();
  program
    .name("storyshelf")
    .description("Self-hosted visual testing for Storybook.")
    .version("0.2.0");
  const commands = [
    buildInitCommand(),
    buildCreateCommand(),
    buildServerCommand(),
    buildPurgeCommand(),
    buildUploadCommand(),
    buildBuildCommand(),
    buildDoctorCommand(),
    buildWhoamiCommand(),
    buildRetryCommand(),
  ];
  for (const command of commands) {
    program.addCommand(command);
  }
  return program;
}

function run<TArgs>(fn: (args: TArgs) => Promise<void>): (args: TArgs) => Promise<void> {
  return async (args: TArgs) => {
    await fn(args).catch(handleError);
  };
}

function buildInitCommand(): Command {
  return new Command("init")
    .description("Initialize Storybook project with .storybook/storyshelf.json (client config)")
    .option("--url <url>", "server base URL")
    .option("--slug <slug>", "project slug")
    .option("--build-dir <dir>", "built Storybook directory (default storybook-static)")
    .option("--build-command <cmd>", 'build command (e.g. "npm run build-storybook")')
    .option("--build-script-name <name>", "npm script to build Storybook (default build-storybook)")
    .option("--skip <glob>", "skip upload for matching branch (glob)")
    .option("-c, --config <path>", "config file path (default .storybook/storyshelf.json)")
    .option(
      "--token <token>",
      "auth token for sync (or STORYSHELF_TOKEN/STORYSHELF_ADMIN_TOKEN env)",
    )
    .action(run<InitOptions>(runInit));
}

function buildCreateCommand(): Command {
  return new Command("create")
    .description("Create a project on StoryShelf server (requires admin token)")
    .option("--url <url>", "server base URL")
    .option("--name <name>", "project name")
    .option("--token <token>", "admin token (or STORYSHELF_ADMIN_TOKEN env)")
    .action(run<CreateOptions>(runCreate));
}

function buildServerCommand(): Command {
  const server = new Command("server").description("Server operations");
  server
    .command("init")
    .description("Scaffold a new StoryShelf server project")
    .option("--dir <dir>", "output directory")
    .action(run<ServerInitOptions>(runServerInit));
  const serve = new Command("serve")
    .description("Run a scaffolded StoryShelf server project")
    .option("--dir <dir>", "server project directory (default cwd)")
    .option("--port <port>", "port override (sets PORT)")
    .action(run<ServerServeOptions>(runServerServe));
  server.addCommand(serve, { isDefault: true });
  return server;
}

function buildPurgeCommand(): Command {
  return new Command("purge")
    .description("Purge expired builds on a StoryShelf server")
    .requiredOption("--url <url>", "server base URL")
    .option("--token <token>", "admin token (or STORYSHELF_ADMIN_TOKEN env)")
    .action(run<PurgeOptions>(runPurge));
}

function buildUploadCommand(): Command {
  return new Command("upload")
    .description("Create a build record for a StoryShelf project")
    .option("--url <url>", "server base URL (or .storybook/storyshelf.json)")
    .option("--slug <slug>", "project slug (or .storybook/storyshelf.json)")
    .option("--token <token>", "CI token (or STORYSHELF_TOKEN env)")
    .option("--sha <sha>", "git sha (or GITHUB_SHA env)")
    .option("--branch <branch>", "git branch (or GITHUB_REF_NAME env)")
    .option("--build-dir <dir>", "built Storybook directory (default storybook-static)")
    .option("-c, --config <path>", "config file path (default .storybook/storyshelf.json)")
    .option("--build-command <cmd>", "build command to run if buildDir missing/empty")
    .option("--build-script-name <name>", "npm script to build Storybook (default build-storybook)")
    .option("--force-build", "force rebuild even if buildDir exists")
    .option("--dry-run", "validate and build without sending any requests")
    .option("--skip <glob>", "skip upload for matching branch (glob)")
    .option("--message <message>", "commit message")
    .option("--author-email <email>", "author email")
    .option("--author-name <name>", "author name")
    .option(
      "--label <key=value>",
      "build label (repeatable: --label pr=123)",
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .action(run<UploadOptions>(runUpload));
}

function buildBuildCommand(): Command {
  return new Command("build")
    .description("Build Storybook for upload (no server contact)")
    .option("--build-dir <dir>", "built Storybook directory (default storybook-static)")
    .option("-c, --config <path>", "config file path (default .storybook/storyshelf.json)")
    .option("--build-command <cmd>", "build command to run if buildDir missing/empty")
    .option("--build-script-name <name>", "npm script to build Storybook (default build-storybook)")
    .option("--force-build", "force rebuild even if buildDir exists")
    .action(run<BuildOptions>(runBuild));
}

function buildDoctorCommand(): Command {
  return new Command("doctor")
    .description("Diagnose whether an upload would succeed (no side effects)")
    .option("--url <url>", "server base URL (or .storybook/storyshelf.json)")
    .option("--slug <slug>", "project slug (or .storybook/storyshelf.json)")
    .option("--token <token>", "CI token (or STORYSHELF_TOKEN env)")
    .option("--build-dir <dir>", "built Storybook directory (default storybook-static)")
    .option("-c, --config <path>", "config file path (default .storybook/storyshelf.json)")
    .option("--build-command <cmd>", "build command to run if buildDir missing/empty")
    .option("--build-script-name <name>", "npm script to build Storybook (default build-storybook)")
    .action(run<DoctorOptions>(runDoctor));
}

function buildWhoamiCommand(): Command {
  return new Command("whoami")
    .description("Verify the token against the server and print the project")
    .option("--url <url>", "server base URL (or .storybook/storyshelf.json)")
    .option("--slug <slug>", "project slug (or .storybook/storyshelf.json)")
    .option("--token <token>", "CI token (or STORYSHELF_TOKEN env)")
    .option("-c, --config <path>", "config file path (default .storybook/storyshelf.json)")
    .action(run<ConnectionOptions>(runWhoami));
}

function buildRetryCommand(): Command {
  return new Command("retry")
    .description("Retry a failed StoryShelf build")
    .requiredOption("--url <url>", "server base URL")
    .requiredOption("--slug <slug>", "project slug")
    .requiredOption("--build-id <id>", "build id")
    .option("--token <token>", "CI token (or STORYSHELF_TOKEN env)")
    .action(run<RetryOptions>(runRetry));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const program = createProgram();
  // Default: `storyshelf` with no args -> upload if config exists, else help to init
  if (process.argv.length <= 2) {
    await runDefaultCommand(program);
  } else {
    program.parse(process.argv);
  }
}
