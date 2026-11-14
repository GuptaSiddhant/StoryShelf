/**
 * The pieces of the `capture` handler that `setupCapture` assembles (ADR 0006, decisions 4 to 6):
 * the hooks for a job that ran out of retries or was abandoned, the choice between running a capture
 * in this process or in a forked child, and the wrapper that alerts admins when a build is left failed.
 */
import {
  createCaptureHandler,
  failCrashedCapture,
  isFinalAttempt,
  switchStoriesVetoed,
  type captureDispatchDeps,
  type CaptureHandlerOptions,
  type ConsumerJob,
  type KindHandler,
} from "@storyshelf/core/capture";
import type { ShelfOptions } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import { createForkedHandler, shouldForkCapture } from "./capture-process.ts";
import type { JobQueue } from "./job-queue.ts";

/** The `capture` handler, with a way to stop a forked child once the consumer has drained. */
export interface CaptureHandler extends KindHandler {
  close?: () => Promise<void>;
}

/** What admins are told: a build left failed, and a build left stuck. */
export interface CaptureAlerts {
  failed: (buildId: string) => Promise<void>;
  stuck: (buildId: string) => Promise<void>;
}

/**
 * What happens to a capture job that ran out of retries (its build fails, admins are alerted) or
 * was abandoned (admins are alerted). Returns the failing hook, which a forked worker's crash uses too.
 */
export function registerCrashHooks(
  jobs: JobQueue,
  dispatch: ReturnType<typeof captureDispatchDeps>,
  alert: CaptureAlerts,
): (job: ConsumerJob, error: string) => Promise<void> {
  const failed = async (job: ConsumerJob, error: string): Promise<void> => {
    await failCrashedCapture(dispatch, job, error);
    await alert.failed(job.buildId);
  };
  jobs.exhausted.capture = failed;
  jobs.abandoned.capture = async (job): Promise<void> => {
    await alert.stuck(job.buildId);
  };
  return failed;
}

/** The capture handler: in this process, or forked into a worker (which falls back to this process). */
export function handlerFor(
  options: ShelfOptions,
  handlerOptions: CaptureHandlerOptions,
  parts: {
    retries: number;
    onCrashed: (job: ConsumerJob, error: string) => Promise<void>;
    logger: Logger;
  },
): CaptureHandler {
  const inProcess = createCaptureHandler(handlerOptions);
  return shouldForkCapture(options.testing, parts.logger)
    ? forkedHandler(options, { fallback: inProcess, ...parts })
    : inProcess;
}

function forkedHandler(
  options: ShelfOptions,
  parts: {
    fallback: KindHandler;
    retries: number;
    onCrashed: (job: ConsumerJob, error: string) => Promise<void>;
    logger: Logger;
  },
): CaptureHandler {
  const testing = options.testing;
  return createForkedHandler({
    workerEntry: testing?.workerEntry ?? "",
    shardSize: testing?.shardSize,
    imageEngine: testing?.images?.engine,
    diffThreads: testing?.compare?.threads,
    switchStoriesVetoed: switchStoriesVetoed(testing),
    ...parts,
  });
}

/**
 * Alert admins when a capture left its build failed: after a run that ended, and after a final
 * attempt that threw (the build may then already be failed by a crash hook). Alerts stay in this
 * process whichever process rendered.
 */
export function alerting(
  inner: CaptureHandler,
  retries: number,
  alert: (buildId: string) => Promise<void>,
): CaptureHandler {
  return {
    accepts: (job) => inner.accepts?.(job) !== false,
    deadlineExceeded: async (job, seconds) => {
      await inner.deadlineExceeded?.(job, seconds);
    },
    superseded: async (job) => (await inner.superseded?.(job)) === true,
    run: async (job, context) => {
      try {
        await inner.run(job, context);
      } catch (error) {
        if (isFinalAttempt(job, retries)) {
          await alert(job.buildId);
        }
        throw error;
      }
      await alert(job.buildId);
    },
    cancel: async (job) => {
      await inner.cancel?.(job);
    },
    ...(inner.close ? { close: inner.close } : {}),
  };
}
