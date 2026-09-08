import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { printLine } from "../../output.ts";

/**
 * Options for `storyshelf server serve` — runs a scaffolded server project.
 */
export interface ServerServeOptions {
  /** Server project directory containing `server.ts` (defaults to `process.cwd()`). */
  dir?: string;
  /** Port override; sets `PORT` for the child process. */
  port?: string;
}

/** Server entry filenames tried in order. */
const SERVER_CANDIDATES = [
  "server.ts",
  "server.js",
  "server.mjs",
  "index.ts",
  "index.js",
  "index.mjs",
] as const;

/** Options for spawning the child server process. */
export interface SpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/** Function that spawns the server child process and resolves with its exit code. */
export type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => Promise<number>;

/**
 * Locate the server entry file in a scaffolded project.
 * Tries `server.ts`, `server.js`, `server.mjs`, then `index.*` fallbacks.
 *
 * @param dir - Absolute path to the server project directory
 * @returns Absolute path to the first entry that exists
 * @throws If no candidate is found (suggests running `storyshelf server init`)
 */
export async function resolveServerFile(dir: string): Promise<string> {
  for (const candidate of SERVER_CANDIDATES) {
    const full = join(dir, candidate);
    try {
      // eslint-disable-next-line no-await-in-loop -- probe candidates in order, return first hit
      await access(full);
      return full;
    } catch {
      continue;
    }
  }
  throw new Error(
    `No server entry found in ${dir} (looked for ${SERVER_CANDIDATES.join(", ")}). Run "storyshelf server init" first.`,
  );
}

/** Node flags for an entry file (TypeScript needs the transform flag). */
function nodeArgs(file: string): string[] {
  return file.endsWith(".ts") ? ["--experimental-transform-types", file] : [file];
}

/** Signal relay handle: stop detaching, relayed reports whether a relay fired. */
interface SignalRelay {
  stop(): void;
  relayed(): boolean;
}

/** Forward SIGINT/SIGTERM to the child; returns a handle to detach and inspect. */
function relaySignals(child: ChildProcess): SignalRelay {
  let relayed = false;
  const relay = (signal: NodeJS.Signals): void => {
    relayed = true;
    child.kill(signal);
  };
  const onSigint = (): void => {
    relay("SIGINT");
  };
  const onSigterm = (): void => {
    relay("SIGTERM");
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  return {
    stop: (): void => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    },
    relayed: (): boolean => relayed,
  };
}

/** Resolve the child exit code (relay-terminated exits count as clean). */
// oxlint-disable-next-line typescript/promise-function-async -- executor-style promise wrapper around events
function waitForExit(child: ChildProcess, relay: SignalRelay): Promise<number> {
  return new Promise<number>((resolvePromise, rejectPromise) => {
    child.on("error", rejectPromise);
    child.on("exit", (code, signal) => {
      if (signal && relay.relayed()) {
        resolvePromise(0);
      } else {
        resolvePromise(code ?? 1);
      }
    });
  });
}

/** Spawn a child server, forwarding signals and resolving its exit code. */
async function defaultSpawnProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): Promise<number> {
  const child = spawn(command, [...args], {
    stdio: "inherit",
    cwd: options.cwd,
    env: options.env,
  });
  const relay = relaySignals(child);
  try {
    return await waitForExit(child, relay);
  } finally {
    relay.stop();
  }
}

async function warnIfUninstalled(dir: string): Promise<void> {
  try {
    await access(join(dir, "node_modules"));
  } catch {
    printLine(
      `Warning: no node_modules in ${dir} — run "npm install" there first if the server fails to start.`,
    );
  }
}

/**
 * Run an existing scaffolded server project.
 *
 * @param options - Directory and port override.
 * @param deps - Injectable process spawner (test seam).
 */
export async function runServerServe(
  options: ServerServeOptions,
  deps: { spawnProcess?: SpawnProcess } = {},
): Promise<void> {
  const dir = resolve(options.dir ?? process.cwd());
  const file = await resolveServerFile(dir);
  await warnIfUninstalled(dir);
  printLine(`Starting server: ${file}`);
  const spawnProcess = deps.spawnProcess ?? defaultSpawnProcess;
  const code = await spawnProcess(process.execPath, nodeArgs(file), {
    cwd: dir,
    env: childEnv(options),
  });
  if (code !== 0) {
    throw new Error(`Server exited with code ${code}`);
  }
}

/** Child environment: inherit the parent, applying the port override. */
function childEnv(options: ServerServeOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (options.port !== undefined) {
    env["PORT"] = options.port;
  }
  return env;
}
