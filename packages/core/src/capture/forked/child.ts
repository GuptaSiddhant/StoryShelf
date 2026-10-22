/**
 * Entry helper for a forked capture child (`testing.workerEntry`). The app is the consumer: it
 * polls the database queue, holds the slots and the lease, and pushes each leased job here over
 * process IPC. The child runs the whole capture pipeline for the job it is given and reports
 * `progress`, then `done` or `failed`. It never reads the queue (ADR 0006, decision 5); the only
 * thing it writes there is the shard jobs a big build fans out into, which it inserts itself.
 *
 * ```ts
 * // capture-worker.ts — the module named by `testing.workerEntry`
 * import { runCaptureChild } from "@storyshelf/core/capture";
 * await runCaptureChild({ db, storage, runner, scratchDir });
 * ```
 */
import { createShelfLogger, type Logger } from "../../logger.ts";
import { createNotifyEnqueuer } from "../build-state/notify-job.ts";
import { createBuildStatePublisher } from "../build-state/publisher.ts";
import type { BuildStatePublisher } from "../build-state/types.ts";
import { createCaptureHandler, type CaptureHandlerOptions } from "../consumer/capture-handler.ts";
import { applyImageSettings, ensureImageEngine } from "../consumer/startup.ts";
import type { CaptureConsumerOptions, ConsumerJob, KindHandler } from "../consumer/types.ts";
import { createDatabaseCaptureQueue, DEFAULT_RETRIES } from "../db-queue/index.ts";
import {
  CAPTURE_RETRIES_ENV,
  CAPTURE_SHARD_SIZE_ENV,
  CAPTURE_STORYBOOK_URL_TTL_ENV,
} from "./fork.ts";
import { isParentMessage, type ChildMessage } from "./protocol.ts";

/** Handler options minus the shard hand-out, which the child wires to the database queue. */
export type CaptureChildOptions = Omit<CaptureHandlerOptions, "enqueue" | "logger"> &
  Pick<CaptureConsumerOptions, "images" | "compare"> & {
    logger?: Logger;
    /** Retries stamped on shard jobs (default: the parent's `testing.retries`, handed down in the environment). */
    retries?: number;
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
 * Run pushed jobs until the parent stops the child.
 *
 * - `SIGTERM` / `SIGINT`: let the runs in flight finish, then exit 0.
 * - Parent gone (`disconnect`): nobody can receive results, so exit at once. Whatever was running
 *   loses its lease with the parent and is redelivered to another consumer.
 *
 * @throws When not running as a forked child (no IPC channel), or when the image engine cannot load.
 */
export async function runCaptureChild(
  options: CaptureChildOptions,
  host: ChildHost = processHost(),
): Promise<void> {
  const { send } = host;
  if (!send) {
    throw new Error("runCaptureChild must run in a forked process; set testing.workerEntry");
  }
  const logger = options.logger ?? createShelfLogger();
  applyImageSettings(options.images, options.compare);
  await ensureImageEngine(logger);
  const child = new CaptureChild(buildHandler(options, host.env, logger), logger, (message) => {
    send.call(host, message);
  });
  const stopped = wireHost(host, child);
  await stopped;
  host.exit(0);
}

/** Feed the parent's messages to the child; resolves once a signal asked it to stop and it drained. */
async function wireHost(host: ChildHost, child: CaptureChild): Promise<void> {
  const stopped = Promise.withResolvers<null>();
  const settle = (): void => {
    stopped.resolve(null);
  };
  const drain = (): void => {
    child.drain().then(settle, settle);
  };
  host.on("message", (message) => {
    child.onMessage(message);
  });
  host.on("SIGTERM", drain);
  host.on("SIGINT", drain);
  host.on("disconnect", () => {
    host.exit(0);
  });
  await stopped.promise;
}

/** The capture handler over the app's own adapters; shard jobs go straight onto the database queue. */
function buildHandler(
  options: CaptureChildOptions,
  env: Record<string, string | undefined>,
  logger: Logger,
): KindHandler {
  const maxRetries = options.retries ?? positiveInt(env[CAPTURE_RETRIES_ENV], 0) ?? DEFAULT_RETRIES;
  const queue = createDatabaseCaptureQueue(options.db, {
    retries: maxRetries,
    logger: logger.child({ component: "child-queue" }),
  });
  return createCaptureHandler({
    db: options.db,
    storage: options.storage,
    runner: options.runner,
    scratchDir: options.scratchDir,
    notifiers: options.notifiers,
    config: options.config,
    // The parent's consumer runs `notify` jobs, so the child hands state deliveries to the queue.
    buildState: options.buildState ?? notifyJobsPublisher(options, queue, logger),
    design: options.design,
    secret: options.secret,
    viewports: options.viewports,
    shardSize: options.shardSize ?? positiveInt(env[CAPTURE_SHARD_SIZE_ENV]),
    storybookUrlTtl: options.storybookUrlTtl ?? positiveInt(env[CAPTURE_STORYBOOK_URL_TTL_ENV]),
    maxRetries,
    enqueue: async (job) => {
      await queue.enqueue(job);
    },
    logger,
  });
}

/** Publisher that queues one `notify` job per git channel on the database queue. */
function notifyJobsPublisher(
  options: CaptureChildOptions,
  queue: ReturnType<typeof createDatabaseCaptureQueue>,
  logger: Logger,
): BuildStatePublisher {
  return createBuildStatePublisher({
    deps: {
      db: options.db,
      storage: options.storage,
      notifiers: options.notifiers ?? [],
      secret: options.secret,
      config: options.config ?? {},
      flags: () => ({ testing: true, review: false }),
      logger,
    },
    enqueue: createNotifyEnqueuer({ db: options.db }, queue),
  });
}

/** One run per pushed job; the parent decides what runs, how many at once, and when it ends. */
class CaptureChild {
  readonly #handler: KindHandler;
  readonly #logger: Logger;
  readonly #send: (message: ChildMessage) => void;
  readonly #running = new Map<string, { job: ConsumerJob; done: Promise<void> }>();

  constructor(handler: KindHandler, logger: Logger, send: (message: ChildMessage) => void) {
    this.#handler = handler;
    this.#logger = logger;
    this.#send = send;
  }

  onMessage(message: unknown): void {
    if (!isParentMessage(message)) {
      return;
    }
    if (message.type === "run") {
      this.#start(message.runId, message.job);
      return;
    }
    const run = this.#running.get(message.runId);
    if (run) {
      this.#handler.cancel?.(run.job).catch(ignore);
    }
  }

  /** Resolves once every run in flight has finished. */
  async drain(): Promise<void> {
    while (this.#running.size > 0) {
      // oxlint-disable-next-line no-await-in-loop -- runs started while draining join the drain
      await Promise.allSettled(
        [...this.#running.values()].map(async (run) => {
          await run.done;
        }),
      );
    }
  }

  #start(runId: string, job: ConsumerJob): void {
    const done = this.#execute(runId, job).finally(() => {
      this.#running.delete(runId);
    });
    this.#running.set(runId, { job, done });
  }

  async #execute(runId: string, job: ConsumerJob): Promise<void> {
    try {
      await this.#handler.run(job, {
        logger: this.#logger.child({ buildId: job.buildId, jobId: job.jobId, runId }),
        touch: throttled(() => {
          this.#send({ type: "progress", runId });
        }),
      });
      this.#send({ type: "done", runId });
    } catch (error) {
      this.#send({
        type: "failed",
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** At most one progress message per second per run: a capture logs far more often than a lease needs. */
const PROGRESS_INTERVAL_MS = 1000;

function throttled(report: () => void): () => void {
  let last = 0;
  return () => {
    const now = Date.now();
    if (now - last >= PROGRESS_INTERVAL_MS) {
      last = now;
      report();
    }
  };
}

function ignore(): void {}

function positiveInt(value: string | undefined, min = 1): number | undefined {
  const parsed = Number(value);
  return value !== undefined && Number.isInteger(parsed) && parsed >= min ? parsed : undefined;
}

function processHost(): ChildHost {
  return {
    send: process.send ? (message) => process.send?.(message) : undefined,
    on: (event, listener) => process.on(event as never, listener as never),
    env: process.env,
    // A forked child has to end its own process once the runs have drained.
    // oxlint-disable-next-line unicorn/no-process-exit
    exit: (code) => process.exit(code),
  };
}
