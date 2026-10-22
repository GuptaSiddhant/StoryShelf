/**
 * The consumer of the app's queues (ADR 0006, decision 5): built when first started, so a host
 * that never starts one never touches the queue, and drained as a unit on teardown.
 */
import {
  createCaptureConsumer,
  type CaptureConsumer,
  type CaptureConsumerOptions,
  type ConsumerMetrics,
} from "@storyshelf/core/capture";
import { captureMetrics } from "@storyshelf/observability";

/** One consumer from options that are only worked out on the first `start()`. */
export function lazyConsumer(
  options: () => CaptureConsumerOptions,
  closers: (() => Promise<void>)[] = [],
): CaptureConsumer {
  let built: CaptureConsumer | undefined;
  return {
    start: async () => {
      built ??= createCaptureConsumer(options());
      await built.start();
    },
    // Stopping one never started is a no-op; the closers (forked child, queue wake) still run.
    stop: async () => {
      await built?.stop();
      for (const close of closers) {
        // oxlint-disable-next-line no-await-in-loop -- close in order, after the drain
        await close();
      }
    },
    isRunning: () => built?.isRunning() ?? false,
  };
}

/** Several consumers as one: they start together and drain together. */
export function combineConsumers(consumers: CaptureConsumer[]): CaptureConsumer | null {
  const [only, ...rest] = consumers;
  if (only === undefined) {
    return null;
  }
  if (rest.length === 0) {
    return only;
  }
  return {
    start: async () => {
      await Promise.all(
        consumers.map(async (consumer) => {
          await consumer.start();
        }),
      );
    },
    stop: async () => {
      await Promise.all(
        consumers.map(async (consumer) => {
          await consumer.stop();
        }),
      );
    },
    isRunning: () => consumers.some((consumer) => consumer.isRunning()),
  };
}

/** Job counts and durations on the capture instruments, told apart by `job.kind`. */
export function jobMetrics(): ConsumerMetrics {
  return {
    jobFinished: (event) => {
      const instruments = captureMetrics();
      const attributes = { "job.kind": event.kind };
      instruments.jobDuration.record(event.durationMs, attributes);
      if (event.outcome === "completed") {
        instruments.jobsCompleted.add(1, attributes);
      } else if (event.outcome === "failed") {
        instruments.jobsFailed.add(1, attributes);
      }
    },
  };
}
