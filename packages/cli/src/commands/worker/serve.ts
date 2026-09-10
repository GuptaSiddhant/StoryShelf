import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { detectPackageRunner, installCommand } from "../../config.ts";
import { printLine } from "../../output.ts";

export interface WorkerServeOptions {
  dir?: string;
  port?: string;
  queueUrl?: string;
  concurrency?: string;
}

const WORKER_CANDIDATES = [
  "worker.ts",
  "worker.js",
  "worker.mjs",
  "index.ts",
  "index.js",
  "index.mjs",
] as const;

export interface SpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => Promise<number>;

export async function resolveWorkerFile(dir: string): Promise<string> {
  for (const candidate of WORKER_CANDIDATES) {
    const full = join(dir, candidate);
    try {
      // eslint-disable-next-line no-await-in-loop -- probe in order
      await access(full);
      return full;
    } catch {
      continue;
    }
  }
  throw new Error(
    `No worker entry found in ${dir} (looked for ${WORKER_CANDIDATES.join(", ")}). Run "storyshelf worker init" first.`,
  );
}

function nodeArgs(file: string): string[] {
  return file.endsWith(".ts") ? ["--experimental-transform-types", file] : [file];
}

interface SignalRelay {
  stop(): void;
  relayed(): boolean;
}

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

// oxlint-disable-next-line typescript/promise-function-async -- executor-style promise wrapper
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
    const runner = await detectPackageRunner(dir);
    printLine(
      `Warning: no node_modules in ${dir} — run "${installCommand(runner)}" there first if the worker fails to start.`,
    );
  }
}

export async function runWorkerServe(
  options: WorkerServeOptions,
  deps: { spawnProcess?: SpawnProcess } = {},
): Promise<void> {
  const dir = resolve(options.dir ?? process.cwd());
  const file = await resolveWorkerFile(dir);
  await warnIfUninstalled(dir);
  printLine(`Starting worker: ${file}`);
  const spawnProcess = deps.spawnProcess ?? defaultSpawnProcess;
  const code = await spawnProcess(process.execPath, nodeArgs(file), {
    cwd: dir,
    env: childEnv(options),
  });
  if (code !== 0) {
    throw new Error(`Worker exited with code ${code}`);
  }
}

function childEnv(options: WorkerServeOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (options.port !== undefined) env["PORT"] = options.port;
  if (options.queueUrl !== undefined) env["QUEUE_URL"] = options.queueUrl;
  if (options.concurrency !== undefined) env["WORKER_CONCURRENCY"] = options.concurrency;
  return env;
}
