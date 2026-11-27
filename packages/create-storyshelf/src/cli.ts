import { parseArgs } from "node:util";
import { runInit } from "./init.ts";
import { packageVersion } from "./version.ts";

const HELP = `create-storyshelf: scaffold a StoryShelf server

Usage: npm create storyshelf [dir] [-- --install]
       create-storyshelf [dir] [--cloud aws|gcp|azure] [--install] [--yes]

  dir            output directory (default: asked)
  --cloud NAME   write a Terraform module stub for aws, gcp or azure instead of a server
  -y, --yes      accept every default without asking (no terminal needed)
  --install      run the package manager's install in the new project (off by default)
  -h, --help     print this help
  -v, --version  print the version

The server is started with \`storyshelf-server serve\` (npm start).`;

const OPTIONS = {
  dir: { type: "string" },
  cloud: { type: "string" },
  install: { type: "boolean" },
  yes: { type: "boolean", short: "y" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

type ParseConfig = { options: typeof OPTIONS; allowPositionals: true };

/** What the arguments ask for: scaffold, help, the version, or an error to print. */
export type Parsed =
  | { kind: "run"; dir?: string; cloud?: string; install: boolean; yes: boolean }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "error"; message: string };

/** The parsed options, or the message of the first bad one. */
function parseOptions(argv: readonly string[]): ReturnType<typeof parseArgs<ParseConfig>> | Error {
  try {
    return parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true });
  } catch (error) {
    return error as Error;
  }
}

/** Parse `argv` (without node and the script). A positional `dir` is the same as `--dir`. */
export function parseArguments(argv: readonly string[]): Parsed {
  const parsed = parseOptions(argv);
  if (parsed instanceof Error) return { kind: "error", message: parsed.message };
  const { values, positionals } = parsed;
  if (values.help === true) return { kind: "help" };
  if (values.version === true) return { kind: "version" };
  if (positionals.length > 1) {
    return { kind: "error", message: `unexpected argument "${positionals[1]}"` };
  }
  const dir = values.dir ?? positionals[0];
  return {
    kind: "run",
    ...(dir === undefined ? {} : { dir }),
    ...(values.cloud === undefined ? {} : { cloud: values.cloud }),
    install: values.install === true,
    yes: values.yes === true,
  };
}

/** The text-only answers (help, version, argument error), or null when a scaffold is to run. */
function immediateAnswer(parsed: Parsed): number | null {
  if (parsed.kind === "help") {
    process.stdout.write(`${HELP}\n`);
  } else if (parsed.kind === "version") {
    process.stdout.write(`${packageVersion() ?? "0.0.0-dev"}\n`);
  } else if (parsed.kind === "error") {
    process.stderr.write(`create-storyshelf: ${parsed.message}\nRun "create-storyshelf --help".\n`);
    return 2;
  } else {
    return null;
  }
  return 0;
}

/** Run `create-storyshelf` for `argv`; resolves with the exit code and never calls `process.exit`. */
export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArguments(argv);
  const answer = immediateAnswer(parsed);
  if (answer !== null || parsed.kind !== "run") return answer ?? 0;
  try {
    await runInit({
      ...(parsed.dir === undefined ? {} : { dir: parsed.dir }),
      ...(parsed.cloud === undefined ? {} : { cloud: parsed.cloud }),
      install: parsed.install,
      yes: parsed.yes,
    });
  } catch (error) {
    process.stderr.write(`create-storyshelf: ${(error as Error).message}\n`);
    return 1;
  }
  return process.exitCode === undefined ? 0 : Number(process.exitCode);
}
