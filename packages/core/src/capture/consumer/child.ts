/**
 * Entry helper for a forked capture child (`testing.workerEntry`): runs the capture consumer against
 * the parent's queue over process IPC.
 *
 * ```ts
 * // capture-worker.ts — the module named by `testing.workerEntry`
 * import { runCaptureChild } from "@storyshelf/core/capture";
 * await runCaptureChild({ db, storage, runner, scratchDir });
 * ```
 */
import type { PollableJob } from "../../adapters/capture-queue.ts";
import { createShelfLogger, type Logger } from "../../logger.ts";
import type { ParentPort } from "../forked/channel.ts";
import { CAPTURE_CONCURRENCY_ENV, CAPTURE_SHARD_SIZE_ENV } from "../forked/fork.ts";
import { IpcCaptureQueue } from "../forked/ipc-queue.ts";
import type { ChildMessage } from "../forked/protocol.ts";
import type { CaptureHandlerOptions } from "./capture-handler.ts";
import { createCaptureConsumer } from "./index.ts";
import type { CaptureConsumer, CaptureConsumerOptions } from "./types.ts";

/** Consumer options minus the queue, which the parent supplies over IPC. */
export type CaptureChildOptions = Omit<CaptureHandlerOptions, "enqueue" | "logger"> &
  Pick<CaptureConsumerOptions, "config" | "images" | "compare" | "metrics"> & {
    logger?: Logger;
  };

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
 * Run the capture consumer until the parent stops it.
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
  const { consumer, queue } = buildConsumer(options, host);
  wireShutdown({ consumer, queue }, host);
  try {
    await consumer.start();
  } catch (error) {
    options.logger?.error({ err: error }, "capture child failed");
    host.exit(1);
    throw error;
  }
  host.exit(0);
}

function buildConsumer(
  options: CaptureChildOptions,
  host: ChildHost,
): { consumer: CaptureConsumer; queue: IpcCaptureQueue } {
  const { send } = host;
  if (!send) {
    throw new Error("runCaptureChild must run in a forked process; set testing.workerEntry");
  }
  const queue = new IpcCaptureQueue(portOf(host, send));
  const { config, images, compare, metrics, logger, ...capture } = options;
  const consumer = createCaptureConsumer({
    queue,
    capture: { ...capture, shardSize: shardSizeOf(options, host.env) },
    config: { ...config, concurrency: concurrencyOf(options, host.env) },
    images,
    compare,
    metrics,
    logger: logger ?? createShelfLogger(),
    onProgress: throttled((job) => {
      queue.reportProgress(job);
    }),
  });
  return { consumer, queue };
}

/** SIGTERM/SIGINT drain gracefully; a vanished parent exits at once. */
function wireShutdown(
  parts: { consumer: CaptureConsumer; queue: IpcCaptureQueue },
  host: ChildHost,
): void {
  const { consumer, queue } = parts;
  let stopping = false;
  const stop = (): void => {
    if (!stopping) {
      stopping = true;
      consumer.stop().catch(ignore);
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

/** At most one progress message per second per job: a capture logs far more often than a lease needs. */
const PROGRESS_INTERVAL_MS = 1000;

function throttled(report: (job: PollableJob) => void): (job: PollableJob) => void {
  const last = new Map<string, number>();
  return (job) => {
    const key = job.receipt ?? job.buildId;
    const now = Date.now();
    if (now - (last.get(key) ?? 0) >= PROGRESS_INTERVAL_MS) {
      last.set(key, now);
      report(job);
    }
  };
}

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

function concurrencyOf(
  options: CaptureChildOptions,
  env: Record<string, string | undefined>,
): number | undefined {
  const fromEnv = Number(env[CAPTURE_CONCURRENCY_ENV]);
  return (
    options.config?.concurrency ?? (Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : undefined)
  );
}

/** The module's own `shardSize`, else the parent's `testing.shardSize` handed down in the environment. */
function shardSizeOf(
  options: CaptureChildOptions,
  env: Record<string, string | undefined>,
): number | undefined {
  const fromEnv = Number(env[CAPTURE_SHARD_SIZE_ENV]);
  return options.shardSize ?? (Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : undefined);
}

function processHost(): ChildHost {
  return {
    send: process.send ? (message) => process.send?.(message) : undefined,
    on: (event, listener) => process.on(event as never, listener as never),
    env: process.env,
    // A forked child has to end its own process once the consumer has drained.
    // oxlint-disable-next-line unicorn/no-process-exit
    exit: (code) => process.exit(code),
  };
}
