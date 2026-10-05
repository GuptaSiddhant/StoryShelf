/**
 * Idle backoff for queues whose `poll()` returns immediately when empty
 * (GCP Pub/Sub synchronous pull, Azure Storage Queues). Queues that long-poll
 * (SQS, Redis, Service Bus) block inside `poll()` and never trigger it.
 */

/** An empty poll that returns faster than this did not long-poll. */
export const MIN_BLOCKING_POLL_MS = 1000;

const BASE_IDLE_MS = 250;
const MAX_IDLE_MS = 5000;

/** Sleep for consecutive fast empty polls: 250ms doubling up to 5s. */
export function idleDelayMs(emptyStreak: number): number {
  return Math.min(MAX_IDLE_MS, BASE_IDLE_MS * 2 ** Math.max(0, emptyStreak - 1));
}

/** Whether an empty poll came back too fast to have blocked on the queue. */
export function isFastEmptyPoll(elapsedMs: number): boolean {
  return elapsedMs < MIN_BLOCKING_POLL_MS;
}
