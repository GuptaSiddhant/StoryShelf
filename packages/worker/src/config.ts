/** Configuration for the capture worker. */
export interface WorkerConfig {
  /** Max concurrent captures (default 2). */
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

export const DEFAULT_WORKER_CONFIG: Required<WorkerConfig> = {
  concurrency: 2,
  visibilityTimeout: 300,
  waitTimeSeconds: 20,
  maxRetries: 2,
  backoffMs: 1000,
};

export function resolveWorkerConfig(input?: WorkerConfig): Required<WorkerConfig> {
  return {
    concurrency: input?.concurrency ?? DEFAULT_WORKER_CONFIG.concurrency,
    visibilityTimeout: input?.visibilityTimeout ?? DEFAULT_WORKER_CONFIG.visibilityTimeout,
    waitTimeSeconds: input?.waitTimeSeconds ?? DEFAULT_WORKER_CONFIG.waitTimeSeconds,
    maxRetries: input?.maxRetries ?? DEFAULT_WORKER_CONFIG.maxRetries,
    backoffMs: input?.backoffMs ?? DEFAULT_WORKER_CONFIG.backoffMs,
  };
}
