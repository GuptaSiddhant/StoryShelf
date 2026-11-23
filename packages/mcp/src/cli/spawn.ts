import { spawn, type ChildProcess } from "node:child_process";

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
export async function defaultSpawnProcess(
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
