import { recommendedBuildConcurrency } from "@storyshelf/core/utils";

/** Configuration for the capture worker. */
export interface WorkerConfig {
  /**
   * Max concurrent captures. Default: sized from the CPU and memory the process can
   * use (1, or 2 with at least 2 CPUs and 3 GB); each capture drives its own browser.
   */
  concurrency?: number;
  /** SQS visibility timeout in seconds (default 300). */
  visibilityTimeout?: number;
  /** Long-poll wait time in seconds (default 20, max 20). */
  waitTimeSeconds?: number;
  /** Max retries before permanent failure (default 2 → 3 attempts total). */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default 1000). */
  backoffMs?: number;
}

/** Static defaults; `concurrency` is resolved from the host (see {@link WorkerConfig}). */
export const DEFAULT_WORKER_CONFIG: Omit<Required<WorkerConfig>, "concurrency"> = {
  visibilityTimeout: 300,
  waitTimeSeconds: 20,
  maxRetries: 2,
  backoffMs: 1000,
};

export function resolveWorkerConfig(input?: WorkerConfig): Required<WorkerConfig> {
  return {
    concurrency: input?.concurrency ?? recommendedBuildConcurrency(),
    visibilityTimeout: input?.visibilityTimeout ?? DEFAULT_WORKER_CONFIG.visibilityTimeout,
    waitTimeSeconds: input?.waitTimeSeconds ?? DEFAULT_WORKER_CONFIG.waitTimeSeconds,
    maxRetries: input?.maxRetries ?? DEFAULT_WORKER_CONFIG.maxRetries,
    backoffMs: input?.backoffMs ?? DEFAULT_WORKER_CONFIG.backoffMs,
  };
}
