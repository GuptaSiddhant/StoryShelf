import { Command } from "commander";
import type { BuildOptions } from "./commands/build.ts";
import type { CancelOptions } from "./commands/cancel.ts";
import type { ConnectionOptions } from "./commands/connection.ts";
import type { CreateOptions } from "./commands/create.ts";
import type { DoctorOptions } from "./commands/doctor.ts";
import type { InitOptions } from "./commands/init.ts";
import type { ProtectOptions } from "./commands/protect.ts";
import type { RetryOptions } from "./commands/retry.ts";
import type { UploadOptions } from "./commands/upload.ts";
import { WAIT_EXIT_HELP } from "./commands/wait-help.ts";
import { cliVersion } from "./config.ts";
import { isMainModule } from "./is-main.ts";
import { printError } from "./output.ts";
import { refuseRenamedCliSettings } from "./settings.ts";

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
    buildUploadCommand(),
    buildBuildCommand(),
    buildDoctorCommand(),
    buildWhoamiCommand(),
    buildRetryCommand(),
    buildCancelCommand(),
    buildProtectCommand(),
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
    .option("--token <token>", "auth token for sync (or SHELF_TOKEN/SHELF_ADMIN_TOKEN env)")
    .action(run<InitOptions>(async () => (await import("./commands/init.ts")).runInit));
}

function buildCreateCommand(): Command {
  return new Command("create")
    .description("Create a project on StoryShelf server (requires admin token)")
    .option("--url <url>", "server base URL")
    .option("--name <name>", "project name")
    .option("--token <token>", "admin token (or SHELF_ADMIN_TOKEN env)")
    .action(run<CreateOptions>(async () => (await import("./commands/create.ts")).runCreate));
}

function buildUploadCommand(): Command {
  return addWaitOptions(
    new Command("upload")
      .description("Create a build record for a StoryShelf project")
      .option("--url <url>", "server base URL (or .storybook/storyshelf.json)")
      .option("--slug <slug>", "project slug (or .storybook/storyshelf.json)")
      .option(
        "--token <token>",
        "CI token (prefer the SHELF_TOKEN env: arguments show in the process list)",
      )
      .option("--sha <sha>", "revision SHA (flag, CI env, local git HEAD, or synthesized local-*)")
      .option("--branch <branch>", "baseline namespace (flag, CI env, local git branch, or local)")
      .option("--build-dir <dir>", "built Storybook directory (default storybook-static)")
      .option("-c, --config <path>", "config file path (default .storybook/storyshelf.json)")
      .option("--build-command <cmd>", "build command to run if buildDir missing/empty")
      .option(
        "--build-script-name <name>",
        "npm script to build Storybook (default build-storybook)",
      )
      .option("--force-build", "force rebuild even if buildDir exists")
      .option("--verbose", "list each resolved commit, branch and author with where it came from")
      .option("--zip", "upload one zip instead of only the changed files (older servers)")
      .option("--dry-run", "validate and build without sending any requests")
      .option("--skip <glob>", "skip upload for matching branch (glob)")
      .option("--message <message>", "build message")
      .option("--author-email <email>", "author email")
      .option("--author-name <name>", "author name")
      .option("--full", "disable affected capture (render every story)")
      .option(
        "--skip-unchanged",
        "record a commit that changed no story as a skipped build, without uploading",
      )
      // Declared first so the negated flag has no implied default: absent means "use the config file".
      .option("--build-stats", "add --stats-json to the build script (default when affected)")
      .option("--no-build-stats", "do not add --stats-json to the build script")
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
      .action(run<UploadOptions>(async () => (await import("./commands/upload.ts")).runUpload)),
  );
}

/** `--wait`, `--timeout` and the exit-code help of `upload`. */
function addWaitOptions(command: Command): Command {
  return command
    .option(
      "--json",
      "print one JSON object on stdout (buildId, url, status, skipped; with --wait also verdict, exitCode); all other output goes to stderr",
    )
    .option("--wait", "follow the build after the upload and exit by how it ended (see below)")
    .option(
      "--timeout <duration>",
      "with --wait, stop waiting after 90, 90s, 30m or 2h (default 30m)",
    )
    .addHelpText("after", `\n${WAIT_EXIT_HELP}`);
}

function buildBuildCommand(): Command {
  return (
    new Command("build")
      .description("Build Storybook for upload (no server contact)")
      .option("--build-dir <dir>", "built Storybook directory (default storybook-static)")
      .option("-c, --config <path>", "config file path (default .storybook/storyshelf.json)")
      .option("--build-command <cmd>", "build command to run if buildDir missing/empty")
      .option(
        "--build-script-name <name>",
        "npm script to build Storybook (default build-storybook)",
      )
      .option("--force-build", "force rebuild even if buildDir exists")
      // Declared first so the negated flag has no implied default: absent means "use the config file".
      .option("--build-stats", "add --stats-json to the build script (default when affected)")
      .option("--no-build-stats", "do not add --stats-json to the build script")
      .action(run<BuildOptions>(async () => (await import("./commands/build.ts")).runBuild))
  );
}

function buildDoctorCommand(): Command {
  return new Command("doctor")
    .description("Diagnose whether an upload would succeed (no side effects)")
    .option("--url <url>", "server base URL (or .storybook/storyshelf.json)")
    .option("--slug <slug>", "project slug (or .storybook/storyshelf.json)")
    .option("--token <token>", "CI token (or SHELF_TOKEN env)")
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
    .option("--token <token>", "CI token (or SHELF_TOKEN env)")
    .option("-c, --config <path>", "config file path (default .storybook/storyshelf.json)")
    .action(run<ConnectionOptions>(async () => (await import("./commands/whoami.ts")).runWhoami));
}

function buildRetryCommand(): Command {
  return new Command("retry")
    .description("Retry a failed or cancelled StoryShelf build")
    .requiredOption("--url <url>", "server base URL")
    .requiredOption("--slug <slug>", "project slug")
    .requiredOption("--build-id <id>", "build id")
    .option("--token <token>", "CI token (or SHELF_TOKEN env)")
    .action(run<RetryOptions>(async () => (await import("./commands/retry.ts")).runRetry));
}

function buildCancelCommand(): Command {
  return new Command("cancel")
    .description("Cancel older unfinished builds, keeping the newest of each branch")
    .option("--url <url>", "server base URL (or .storybook/storyshelf.json)")
    .option("--slug <slug>", "project slug (or .storybook/storyshelf.json)")
    .option("--token <token>", "CI token (or SHELF_TOKEN env)")
    .option("-c, --config <path>", "config file path (default .storybook/storyshelf.json)")
    .option("--branch <name>", "only cancel builds of this branch")
    .option("--keep-newest <n>", "unfinished builds to keep per branch (default 1)")
    .option("--dry-run", "list what would be cancelled without cancelling")
    .action(run<CancelOptions>(async () => (await import("./commands/cancel.ts")).runCancel));
}

function buildProtectCommand(): Command {
  return new Command("protect")
    .description(
      "Print and validate the required-check rule that makes StoryShelf gate merges (dry run unless --apply)",
    )
    .requiredOption("--provider <host>", "git host: github or gitlab")
    .requiredOption("--repo <repo>", "owner/repo (GitHub) or group/project (GitLab)")
    .option("--branch <name>", "branch to protect (default main)")
    .option("--prefix <prefix>", "the channel's status prefix (default storyshelf)")
    .option("--gate <name>", "testing (default) or review for a project with testing off")
    .option("--host <url>", "self-managed GitLab host (default https://gitlab.com)")
    .option("--token <token>", "admin token (or GITHUB_TOKEN / GITLAB_TOKEN env)")
    .option("--apply", "write the rule; without it nothing is changed")
    .action(run<ProtectOptions>(async () => (await import("./commands/protect.ts")).runProtect));
}

/** Run the CLI: `storyshelf` with no args uploads if config exists, else helps to init. */
async function main(): Promise<void> {
  const program = createProgram();
  if (process.argv.length <= 2) {
    const { runDefaultCommand } = await import("./commands/default.ts");
    await runDefaultCommand(program);
  } else {
    program.parse(process.argv);
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  // The variables were renamed with no aliases (#1308): refuse while an old name is set, naming it.
  try {
    const ignored = refuseRenamedCliSettings(process.env);
    if (ignored.length > 0) {
      printError(
        `storyshelf: old StoryShelf variable names are set and ignored (SHELF_ALLOW_OLD_NAMES=1): ${ignored.join(", ")}`,
      );
    }
  } catch (error) {
    printError(`storyshelf: ${(error as Error).message}`);
    process.exitCode = 1;
  }
  if (process.exitCode !== 1) {
    await main();
  }
}
