/**
 * Retry policy of the capture consumer, in one place: how many times a failing job is redelivered,
 * how long each retry waits, and which delivery is the last. The numbers match ADR 0006,
 * decision 11 (`testing.retries` defaults to 2: three attempts in total).
 */
import type { PollableJob } from "../../adapters/capture-queue.ts";

/** Retries after the first attempt before a job is failed for good (three attempts in total). */
export const DEFAULT_MAX_RETRIES = 2;
/** Base of the exponential retry delay: the n-th retry waits `base * 2^n` ms. */
export const DEFAULT_BACKOFF_MS = 1000;
/** Longest a retry waits, however many attempts were made. */
export const MAX_BACKOFF_MS = 30_000;
/** Long-poll wait handed to queues that block inside `poll` (SQS, Redis, Service Bus, IPC). */
export const DEFAULT_WAIT_TIME_SECONDS = 20;

/** Retry knobs of the consumer. */
export interface RetryConfig {
  /** Retries after the first attempt (default {@link DEFAULT_MAX_RETRIES}). */
  maxRetries?: number;
  /** Base delay of the exponential backoff in ms (default {@link DEFAULT_BACKOFF_MS}). */
  backoffMs?: number;
}

/** Delay before retry number `attempts` (0 = the first retry): `base * 2^attempts`, capped. */
export function backoffDelayMs(attempts: number, baseMs: number = DEFAULT_BACKOFF_MS): number {
  return Math.min(MAX_BACKOFF_MS, baseMs * 2 ** attempts);
}

/**
 * Whether this delivery is the job's last. A queue that enforces its own limit (the database queue
 * stamps `maxAttempts` on every job and fails the job when the last attempt is nacked) decides:
 * `attempt >= maxAttempts`. For queues that only count deliveries, `attempts >= maxRetries`.
 */
export function isFinalAttempt(
  job: PollableJob & { attempt?: number; maxAttempts?: number },
  maxRetries: number = DEFAULT_MAX_RETRIES,
): boolean {
  const attempts = job.attempts ?? 0;
  if (typeof job.maxAttempts === "number") {
    return (job.attempt ?? attempts + 1) >= job.maxAttempts;
  }
  return attempts >= maxRetries;
}

/** Retries a job may still get, as the capture dispatch counts them (`maxAttempts - 1` when known). */
export function retriesOf(
  job: PollableJob & { maxAttempts?: number },
  fallback: number = DEFAULT_MAX_RETRIES,
): number {
  return typeof job.maxAttempts === "number" ? Math.max(0, job.maxAttempts - 1) : fallback;
}
