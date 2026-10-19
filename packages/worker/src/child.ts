/**
 * Entry helper for a forked capture child (`capture.workerEntry`): runs the capture worker against
 * the parent's queue over process IPC.
 *
 * ```ts
 * // capture-worker.ts — the module named by `capture.workerEntry`
 * import { runCaptureChild } from "@storyshelf/worker";
 * await runCaptureChild({ db, storage, runner, scratchDir });
 * ```
 */
import { CAPTURE_CONCURRENCY_ENV, IpcCaptureQueue } from "@storyshelf/core/capture";
import type { ChildMessage, ParentPort } from "@storyshelf/core/capture";
import {
  createCaptureWorker,
  type WorkerHandle,
  type WorkerOptions,
  type WorkerTables,
} from "./worker.ts";

/** Worker options minus the queue and its overrides, which the parent supplies over IPC. */
export type CaptureChildOptions = Omit<WorkerOptions, "queue" | "poll" | "ack" | "nack" | "extend">;

/** The slice of `process` the child uses; injectable so the lifecycle is testable. */
export interface ChildHost {
  /** Present only in a forked process with an IPC channel. */
  send?: (message: ChildMessage) => unknown;
  on(
    event: "message" | "disconnect" | "SIGTERM" | "SIGINT",
    listener: (message?: unknown) => void,
  ): unknown;
  env: Record<string, string | undefined>;
  exit(code: number): void;
}

/**
 * Run the capture worker until the parent stops it.
 *
 * - `SIGTERM` / `SIGINT`: stop polling, let in-flight captures finish, exit 0.
 * - Parent gone (`disconnect`): nobody can receive results, so exit at once. Whatever was running
 *   stays `capturing` and the parent's boot recovery requeues it.
 *
 * @throws When not running as a forked child (no IPC channel).
 */
export async function runCaptureChild(
  options: CaptureChildOptions,
  host: ChildHost = processHost(),
): Promise<void> {
  const { worker, queue } = buildWorker(options, host);
  wireShutdown({ worker, queue }, host);
  try {
    await worker.start();
  } catch (error) {
    options.logger?.error({ err: error }, "capture child failed");
    host.exit(1);
    throw error;
  }
  host.exit(0);
}

function buildWorker(
  options: CaptureChildOptions,
  host: ChildHost,
): { worker: WorkerHandle; queue: IpcCaptureQueue } {
  const { send } = host;
  if (!send) {
    throw new Error("runCaptureChild must run in a forked process; set capture.workerEntry");
  }
  const queue = new IpcCaptureQueue(portOf(host, send));
  const worker = createCaptureWorker({
    ...options,
    queue,
    tables: options.tables ?? tablesOf(options),
    config: { ...options.config, concurrency: concurrencyOf(options, host.env) },
  });
  return { worker, queue };
}

/** SIGTERM/SIGINT drain gracefully; a vanished parent exits at once. */
function wireShutdown(
  parts: { worker: WorkerHandle; queue: IpcCaptureQueue },
  host: ChildHost,
): void {
  const { worker, queue } = parts;
  let stopping = false;
  const stop = (): void => {
    if (!stopping) {
      stopping = true;
      worker.stop().catch(ignore);
      // Release a poll parked on the parent so stopping does not wait out the long poll.
      queue.lifecycle.teardown().catch(ignore);
    }
  };
  host.on("SIGTERM", stop);
  host.on("SIGINT", stop);
  host.on("disconnect", () => {
    host.exit(0);
  });
}

function ignore(): void {}

function portOf(host: ChildHost, send: NonNullable<ChildHost["send"]>): ParentPort {
  return {
    send: (message) => {
      send.call(host, message);
    },
    onMessage: (listener) => {
      host.on("message", listener);
    },
    onDisconnect: (listener) => {
      host.on("disconnect", listener);
    },
  };
}

/** The adapter's own table handles: the sqlite defaults would be wrong for Postgres or MySQL. */
function tablesOf(options: CaptureChildOptions): WorkerTables {
  return options.db.tables as unknown as WorkerTables;
}

function concurrencyOf(
  options: CaptureChildOptions,
  env: Record<string, string | undefined>,
): number | undefined {
  const fromEnv = Number(env[CAPTURE_CONCURRENCY_ENV]);
  return (
    options.config?.concurrency ?? (Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : undefined)
  );
}

function processHost(): ChildHost {
  return {
    send: process.send ? (message) => process.send?.(message) : undefined,
    on: (event, listener) => process.on(event as never, listener as never),
    env: process.env,
    // A forked child has to end its own process once the worker has drained.
    // oxlint-disable-next-line unicorn/no-process-exit
    exit: (code) => process.exit(code),
  };
}
