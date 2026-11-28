import { packageVersion } from "../package-version.ts";
import { parseServerArgs, type ParsedArgs, type ServerCommand } from "./args.ts";
import type { CommandContext } from "./commands/context.ts";
import { failureLines } from "./failure-lines.ts";
import { SERVER_HELP } from "./help.ts";
import type { Io } from "./io.ts";
import { nodeVersionProblem } from "./node-version.ts";

type Run = Extract<ParsedArgs, { kind: "run" }>;

/** Each command loads on demand, so `--help` and argument errors import no adapter. */
const LOADERS: Record<ServerCommand, (ctx: CommandContext) => Promise<number>> = {
  serve: async (ctx) => (await import("./commands/serve.ts")).serve(ctx),
  migrate: async (ctx) => (await import("./commands/migrate.ts")).migrate(ctx),
  purge: async (ctx) => (await import("./commands/purge.ts")).purge(ctx),
  "check-storage": async (ctx) => (await import("./commands/check-storage.ts")).checkStorage(ctx),
  doctor: async (ctx) => (await import("./commands/doctor.ts")).doctor(ctx),
  invite: async (ctx) => (await import("./commands/invite.ts")).invite(ctx),
};

/** The text-only answers (help, version, argument error), or null when a command is to run. */
function immediateAnswer(parsed: ParsedArgs, io: Io): number | null {
  if (parsed.kind === "help") io.out(SERVER_HELP);
  else if (parsed.kind === "version") io.out(packageVersion());
  else if (parsed.kind === "error") {
    io.err(
      `storyshelf-server: ${parsed.message}\nRun "storyshelf-server --help" for the commands.`,
    );
    return 2;
  } else return null;
  return 0;
}

/** Whether `nodeVersion` is below the supported range; if so the one-line reason is already printed. */
function refuseOldNode(nodeVersion: string, io: Io): boolean {
  const problem = nodeVersionProblem(nodeVersion);
  if (problem !== undefined) io.err(problem);
  return problem !== undefined;
}

/**
 * Load the instance's `.env` (the shell's variables win), then refuse renamed settings (#1308) before
 * the instance module reads any of them.
 */
async function prepareEnvironment(run: Run, env: NodeJS.ProcessEnv): Promise<void> {
  const { loadDotEnv } = await import("./env-file.ts");
  const { refuseRenamedSettings } = await import("@storyshelf/core/config");
  await loadDotEnv(run.flags.dir ?? process.cwd(), env);
  refuseRenamedSettings(env);
}

/**
 * Run `storyshelf-server` for `argv` (without node and the script). Resolves with the exit code and
 * never calls `process.exit`. With no command it prints the help, exit 0.
 */
export async function runServerBin(
  argv: readonly string[],
  io: Io,
  env: NodeJS.ProcessEnv = process.env,
  nodeVersion: string = process.versions.node,
): Promise<number> {
  const parsed = parseServerArgs(argv);
  const answer = immediateAnswer(parsed, io);
  if (answer !== null || parsed.kind !== "run") return answer ?? 0;
  if (refuseOldNode(nodeVersion, io)) return 1;
  try {
    await prepareEnvironment(parsed, env);
    return await LOADERS[parsed.command]({ flags: parsed.flags, io, env });
  } catch (error) {
    io.err(`storyshelf-server ${parsed.command}: ${(error as Error).message}`);
    for (const line of failureLines(error)) io.err(line);
    return 1;
  }
}
