import { refuseRenamedSettings } from "@storyshelf/core/config";
import { packageVersion } from "../package-version.ts";
import { parseServerArgs, type ParsedArgs, type ServerCommand } from "./args.ts";
import { SERVER_HELP } from "./help.ts";
import type { Io } from "./io.ts";

type Run = Extract<ParsedArgs, { kind: "run" }>;

/** Each command loads on demand, so `--help` and argument errors import no adapter. */
const LOADERS: Record<ServerCommand, (run: Run, io: Io) => Promise<number>> = {
  serve: async (run, io) => (await import("./commands/serve.ts")).serve(run.flags, io),
  migrate: async (run, io) => (await import("./commands/migrate.ts")).migrate(run.flags, io),
  purge: async (run, io) => (await import("./commands/purge.ts")).purge(run.flags, io),
  "check-storage": async (run, io) =>
    (await import("./commands/check-storage.ts")).checkStorage(run.flags, io),
  doctor: async (run, io) => (await import("./commands/doctor.ts")).doctor(run.flags, io),
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

/**
 * Run `storyshelf-server` for `argv` (without node and the script). Resolves with the exit code and
 * never calls `process.exit`. With no command it prints the help, exit 0.
 */
export async function runServerBin(
  argv: readonly string[],
  io: Io,
  env = process.env,
): Promise<number> {
  const parsed = parseServerArgs(argv);
  const answer = immediateAnswer(parsed, io);
  if (answer !== null || parsed.kind !== "run") return answer ?? 0;
  try {
    // Renamed variables are refused before the instance module reads any of them (#1308).
    refuseRenamedSettings(env);
    return await LOADERS[parsed.command](parsed, io);
  } catch (error) {
    io.err(`storyshelf-server ${parsed.command}: ${(error as Error).message}`);
    return 1;
  }
}
