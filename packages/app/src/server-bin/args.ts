import { parseArgs } from "node:util";

/** The instance commands, in the order help lists them. */
export const SERVER_COMMANDS = [
  "serve",
  "migrate",
  "purge",
  "check-storage",
  "doctor",
  "invite",
] as const;

/** One of {@link SERVER_COMMANDS}. */
export type ServerCommand = (typeof SERVER_COMMANDS)[number];

/** Flags every command may take; each command reads the ones it documents. */
export interface ServerFlags {
  /** Instance project directory (default: the current directory). */
  dir?: string;
  /** The instance module, relative to `dir` (default: `package.json#storyshelf.server`, then a name search). */
  entry?: string;
  /** `serve`: restart on changes of the instance module's files (Node's `--watch`). */
  watch?: boolean;
  /** `serve`: TCP port (default `PORT`, then 3000). */
  port?: number;
  /** `purge`: retention in days (default: the instance's own setting). */
  ttlDays?: number;
  /** `check-storage`: check only the newest n builds. */
  sample?: number;
  /** `invite`: the display name (default: the part of the email before the `@`). */
  name?: string;
  /** `invite`: the site role (default `member`). */
  role?: string;
  /** `invite`: the address to invite. */
  email?: string;
}

/** What the arguments ask for: a command to run, help, the version, or an error to print. */
export type ParsedArgs =
  | { kind: "run"; command: ServerCommand; flags: ServerFlags }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "error"; message: string };

const OPTIONS = {
  dir: { type: "string" },
  entry: { type: "string" },
  watch: { type: "boolean" },
  port: { type: "string" },
  "ttl-days": { type: "string" },
  sample: { type: "string" },
  name: { type: "string" },
  role: { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

function positiveInt(name: string, raw: string | undefined): number | undefined | Error {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0
    ? value
    : new Error(`--${name} must be a positive whole number, got "${raw}"`);
}

interface RawValues {
  dir?: string | undefined;
  entry?: string | undefined;
  watch?: boolean | undefined;
  port?: string | undefined;
  "ttl-days"?: string | undefined;
  sample?: string | undefined;
  name?: string | undefined;
  role?: string | undefined;
}

/** The flags of `values`, or the error of the first bad number. */
function flagsOf(values: RawValues): ServerFlags | Error {
  const parsed = {
    port: positiveInt("port", values.port),
    ttlDays: positiveInt("ttl-days", values["ttl-days"]),
    sample: positiveInt("sample", values.sample),
  };
  const bad = Object.values(parsed).find((value) => value instanceof Error);
  if (bad instanceof Error) return bad;
  const flags: ServerFlags = {
    ...(values.dir === undefined ? {} : { dir: values.dir }),
    ...(values.entry === undefined ? {} : { entry: values.entry }),
    ...(values.watch === true ? { watch: true } : {}),
    ...(values.name === undefined ? {} : { name: values.name }),
    ...(values.role === undefined ? {} : { role: values.role }),
  };
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== undefined) Object.assign(flags, { [key]: value });
  }
  return flags;
}

function isCommand(value: string): value is ServerCommand {
  return (SERVER_COMMANDS as readonly string[]).includes(value);
}

/** What the positionals ask for, apart from flags: the command, help, or an error. */
function commandOf(positionals: readonly string[], help: boolean): ServerCommand | ParsedArgs {
  const [command, ...rest] = positionals;
  if (help || command === undefined || command === "help") return { kind: "help" };
  if (!isCommand(command)) return { kind: "error", message: `unknown command "${command}"` };
  const allowed = command === "invite" ? 1 : 0;
  if (rest.length > allowed) {
    return { kind: "error", message: `unexpected argument "${rest[allowed]}"` };
  }
  return command;
}

/** Parse the options of `argv`, or the error that ends the run. */
function parseOptions(
  argv: readonly string[],
): ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>> | Error {
  try {
    return parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true });
  } catch (error) {
    return error as Error;
  }
}

/** Parse `argv` (without the node and script entries). Pure: loads nothing and connects nowhere. */
export function parseServerArgs(argv: readonly string[]): ParsedArgs {
  const parsed = parseOptions(argv);
  if (parsed instanceof Error) return { kind: "error", message: parsed.message };
  if (parsed.values.version) return { kind: "version" };
  const command = commandOf(parsed.positionals, parsed.values.help === true);
  if (typeof command !== "string") return command;
  const flags = flagsOf(parsed.values);
  if (flags instanceof Error) return { kind: "error", message: flags.message };
  if (command === "invite") {
    const email = parsed.positionals[1];
    if (email === undefined)
      return { kind: "error", message: "invite needs an email: invite <email>" };
    flags.email = email;
  } else if (flags.name !== undefined || flags.role !== undefined) {
    return { kind: "error", message: "--name and --role are only for `invite`" };
  }
  if (flags.watch === true && command !== "serve") {
    return { kind: "error", message: "--watch is only for `serve`" };
  }
  return { kind: "run", command, flags };
}
