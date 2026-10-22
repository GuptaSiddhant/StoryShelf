/** The real `child_process.fork` behind {@link ChildProcessHandle}. */
import type { ChildProcess } from "node:child_process";
import type { ChildProcessHandle } from "./channel.ts";
import type { ParentMessage } from "./protocol.ts";

/** Environment variable the forked child sees; set to this value so a module can tell it is the child. */
export const CAPTURE_WORKER_ROLE = "capture-worker";

/** Environment variable carrying the parent's `testing.retries` to the child, which stamps it on the shard jobs it queues. */
export const CAPTURE_RETRIES_ENV = "STORYSHELF_CAPTURE_RETRIES";

/** Environment variable carrying the parent's `testing.shardSize` to the child, which plans big builds with it. */
export const CAPTURE_SHARD_SIZE_ENV = "STORYSHELF_CAPTURE_SHARD_SIZE";

/** Grace between SIGTERM and SIGKILL when the parent stops a child. */
const KILL_ESCALATION_MS = 30_000;

type ChildProcessModule = typeof import("node:child_process");

/** `node:child_process`, or undefined where the runtime has none (edge, browsers). Loaded synchronously. */
function childProcessModule(): ChildProcessModule | undefined {
  const getBuiltin = (process as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  return typeof getBuiltin === "function"
    ? (getBuiltin.call(process, "node:child_process") as ChildProcessModule | undefined)
    : undefined;
}

/** Whether this runtime can fork a capture child. */
export function canForkCaptureChild(): boolean {
  return typeof childProcessModule()?.fork === "function";
}

/** Options for {@link forkCaptureChild}. */
export interface ForkOptions {
  /** Module to run in the child (`testing.workerEntry`); absolute path or `file:` URL. */
  entry: string;
  /** Extra environment for the child, on top of this process's. */
  env?: Record<string, string>;
}

/**
 * Fork the capture child with an IPC channel and wrap it as a {@link ChildProcessHandle}.
 *
 * The channel is also the lifeline: if this process dies the child sees `disconnect` and exits.
 * An `exit` hook kills the child too, for parents that stop without a graceful teardown.
 *
 * @throws When the runtime cannot fork, or the fork itself throws.
 */
export function forkCaptureChild(options: ForkOptions): ChildProcessHandle {
  const childProcess = childProcessModule();
  if (!childProcess) {
    throw new Error("child processes are not available in this runtime");
  }
  const child = childProcess.fork(options.entry, [], {
    env: { ...process.env, ...options.env, STORYSHELF_ROLE: CAPTURE_WORKER_ROLE },
    serialization: "json",
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });
  const stopOnExit = (): void => {
    child.kill("SIGKILL");
  };
  process.once("exit", stopOnExit);
  return wrap(child, stopOnExit);
}

function wrap(child: ChildProcess, stopOnExit: () => void): ChildProcessHandle {
  return {
    send: (message: ParentMessage): void => {
      if (child.connected) {
        child.send(message);
      }
    },
    onMessage: (listener) => {
      child.on("message", listener);
    },
    onExit: (listener) => {
      let reported = false;
      const report = (code: number | null, signal: string | null): void => {
        if (!reported) {
          reported = true;
          process.off("exit", stopOnExit);
          listener({ code, signal });
        }
      };
      child.once("exit", report);
      // A child that never started emits `error` and no `exit`.
      child.once("error", () => {
        report(1, null);
      });
    },
    kill: (force) => {
      if (force) {
        child.kill("SIGKILL");
        return;
      }
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, KILL_ESCALATION_MS).unref();
    },
  };
}
