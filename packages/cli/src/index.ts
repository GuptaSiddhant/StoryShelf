import { Command } from "commander";
import type { BuildOptions } from "./commands/build.ts";
import type { ConnectionOptions } from "./commands/connection.ts";
import type { CreateOptions } from "./commands/create.ts";
import type { DoctorOptions } from "./commands/doctor.ts";
import type { InitOptions } from "./commands/init.ts";
import type { PurgeOptions } from "./commands/purge.ts";
import type { RetryOptions } from "./commands/retry.ts";
import type { ServerInitOptions } from "./commands/server/init.ts";
import type { ServerServeOptions } from "./commands/server/serve.ts";
import type { UploadOptions } from "./commands/upload.ts";
import type { WorkerInitOptions } from "./commands/worker/init.ts";
import type { WorkerServeOptions } from "./commands/worker/serve.ts";
import { cliVersion } from "./config.ts";
import { isMainModule } from "./is-main.ts";

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
    .version(cliVersion() ?? "0.0.0-dev");
  const commands = [
    buildInitCommand(),
    buildCreateCommand(),
    buildServerCommand(),
    buildWorkerCommand(),
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

/**
 * Wrap a command so its module (and heavy dependencies such as the zip library
 * or prompts) loads only when that command runs. `storyshelf -h` and the other
 * commands then skip ~40 ms of imports they never use.
 */
function run<TArgs>(
  load: () => Promise<(args: TArgs) => Promise<void>>,
): (args: TArgs) => Promise<void> {
  return async (args: TArgs) => {
    try {
      const command = await load();
      await command(args);
    } catch (error) {
      const { handleError } = await import("./commands/default.ts");
      handleError(error);
    }
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
    .action(run<InitOptions>(async () => (await import("./commands/init.ts")).runInit));
}

function buildCreateCommand(): Command {
  return new Command("create")
    .description("Create a project on StoryShelf server (requires admin token)")
    .option("--url <url>", "server base URL")
    .option("--name <name>", "project name")
    .option("--token <token>", "admin token (or STORYSHELF_ADMIN_TOKEN env)")
    .action(run<CreateOptions>(async () => (await import("./commands/create.ts")).runCreate));
}

function buildServerCommand(): Command {
  const server = new Command("server").description("Server operations");
  server
    .command("init")
    .description("Scaffold a new StoryShelf server project")
    .option("--dir <dir>", "output directory")
    .action(
      run<ServerInitOptions>(async () => (await import("./commands/server/init.ts")).runServerInit),
    );
  const serve = new Command("serve")
    .description("Run a scaffolded StoryShelf server project")
    .option("--dir <dir>", "server project directory (default cwd)")
    .option("--port <port>", "port override (sets PORT)")
    .action(
      run<ServerServeOptions>(
        async () => (await import("./commands/server/serve.ts")).runServerServe,
      ),
    );
  server.addCommand(serve, { isDefault: true });
  return server;
}

function buildWorkerCommand(): Command {
  const worker = new Command("worker").description("Worker operations");
  worker
    .command("init")
    .description("Scaffold a new StoryShelf worker project")
    .option("--dir <dir>", "output directory")
    .action(
      run<WorkerInitOptions>(async () => (await import("./commands/worker/init.ts")).runWorkerInit),
    );
  worker
    .command("serve")
    .description("Run a scaffolded StoryShelf worker project")
    .option("--dir <dir>", "worker project directory (default cwd)")
    .option("--queue-url <url>", "SQS queue URL override (sets QUEUE_URL)")
    .option("--concurrency <n>", "concurrency override (sets WORKER_CONCURRENCY)")
    .action(
      run<WorkerServeOptions>(
        async () => (await import("./commands/worker/serve.ts")).runWorkerServe,
      ),
    );
  const runCmd = new Command("run")
    .description("Run a scaffolded worker (alias for worker serve)")
    .option("--dir <dir>", "worker project directory (default cwd)")
    .option("--queue-url <url>", "SQS queue URL override")
    .option("--concurrency <n>", "concurrency override")
    .action(
      run<WorkerServeOptions>(
        async () => (await import("./commands/worker/serve.ts")).runWorkerServe,
      ),
    );
  worker.addCommand(runCmd);
  return worker;
}

function buildPurgeCommand(): Command {
  return new Command("purge")
    .description("Purge expired builds on a StoryShelf server")
    .requiredOption("--url <url>", "server base URL")
    .option("--token <token>", "admin token (or STORYSHELF_ADMIN_TOKEN env)")
    .action(run<PurgeOptions>(async () => (await import("./commands/purge.ts")).runPurge));
}

function buildUploadCommand(): Command {
  return new Command("upload")
    .description("Create a build record for a StoryShelf project")
    .option("--url <url>", "server base URL (or .storybook/storyshelf.json)")
    .option("--slug <slug>", "project slug (or .storybook/storyshelf.json)")
    .option("--token <token>", "CI token (or STORYSHELF_TOKEN env)")
    .option("--sha <sha>", "revision SHA (flag, CI env, local git HEAD, or synthesized local-*)")
    .option("--branch <branch>", "baseline namespace (flag, CI env, local git branch, or local)")
    .option("--build-dir <dir>", "built Storybook directory (default storybook-static)")
    .option("-c, --config <path>", "config file path (default .storybook/storyshelf.json)")
    .option("--build-command <cmd>", "build command to run if buildDir missing/empty")
    .option("--build-script-name <name>", "npm script to build Storybook (default build-storybook)")
    .option("--force-build", "force rebuild even if buildDir exists")
    .option("--dry-run", "validate and build without sending any requests")
    .option("--skip <glob>", "skip upload for matching branch (glob)")
    .option("--message <message>", "build message")
    .option("--author-email <email>", "author email")
    .option("--author-name <name>", "author name")
    .option("--full", "disable affected capture (render every story)")
    .option(
      "--untraced <glob>",
      "exclude matching files from affected tracing (repeatable)",
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .option("--stats-file <path>", "bundler stats file (default <buildDir>/preview-stats.json)")
    .option(
      "--label <key=value>",
      "build label (repeatable: --label pr=123)",
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .action(run<UploadOptions>(async () => (await import("./commands/upload.ts")).runUpload));
}

function buildBuildCommand(): Command {
  return new Command("build")
    .description("Build Storybook for upload (no server contact)")
    .option("--build-dir <dir>", "built Storybook directory (default storybook-static)")
    .option("-c, --config <path>", "config file path (default .storybook/storyshelf.json)")
    .option("--build-command <cmd>", "build command to run if buildDir missing/empty")
    .option("--build-script-name <name>", "npm script to build Storybook (default build-storybook)")
    .option("--force-build", "force rebuild even if buildDir exists")
    .action(run<BuildOptions>(async () => (await import("./commands/build.ts")).runBuild));
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
    .action(run<DoctorOptions>(async () => (await import("./commands/doctor.ts")).runDoctor));
}

function buildWhoamiCommand(): Command {
  return new Command("whoami")
    .description("Verify the token against the server and print the project")
    .option("--url <url>", "server base URL (or .storybook/storyshelf.json)")
    .option("--slug <slug>", "project slug (or .storybook/storyshelf.json)")
    .option("--token <token>", "CI token (or STORYSHELF_TOKEN env)")
    .option("-c, --config <path>", "config file path (default .storybook/storyshelf.json)")
    .action(run<ConnectionOptions>(async () => (await import("./commands/whoami.ts")).runWhoami));
}

function buildRetryCommand(): Command {
  return new Command("retry")
    .description("Retry a failed StoryShelf build")
    .requiredOption("--url <url>", "server base URL")
    .requiredOption("--slug <slug>", "project slug")
    .requiredOption("--build-id <id>", "build id")
    .option("--token <token>", "CI token (or STORYSHELF_TOKEN env)")
    .action(run<RetryOptions>(async () => (await import("./commands/retry.ts")).runRetry));
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const program = createProgram();
  // Default: `storyshelf` with no args -> upload if config exists, else help to init
  if (process.argv.length <= 2) {
    const { runDefaultCommand } = await import("./commands/default.ts");
    await runDefaultCommand(program);
  } else {
    program.parse(process.argv);
  }
}
