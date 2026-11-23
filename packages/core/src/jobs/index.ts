/**
 * Background jobs (ADR 0006, ADR 0040): the one database queue every job kind lives in, its poll
 * cadence and lease keeper, the job lease, and the consumer that runs a handler per job `kind`.
 * The `capture` kind's handler is testing code (`createCaptureHandler` from `/capture`); `publish`
 * and `notify` register theirs from `/publish` and `/build-state`.
 */
export { ProgressLease, type JobLease } from "./job-lease.ts";
export {
  createDatabaseCaptureQueue,
  DATABASE_QUEUE_METADATA,
  DEFAULT_LEASE_MS,
  DEFAULT_RETRIES,
  LEASE_EXHAUSTED_ERROR,
  MAX_NACK_DELAY_MS,
  type DatabaseCaptureQueue,
  type DatabaseCaptureQueueOptions,
  type DatabaseJob,
  type QueueJobInput,
} from "./db-queue/index.ts";
export {
  ACTIVE_POLL_MS,
  ACTIVE_WINDOW_MS,
  CANCEL_CHECK_MS,
  DEFAULT_CADENCE,
  IDLE_POLL_MS,
  nextPollDelay,
  POLL_JITTER,
  type PollCadence,
} from "./db-queue/cadence.ts";
export {
  keepJobLease,
  RENEW_THROTTLE_MS,
  type JobLeaseKeeper,
  type LeaseEnd,
  type LeaseKeeperOptions,
} from "./db-queue/keeper.ts";
export { startPollLoop, type PollLoop, type PollLoopOptions } from "./db-queue/poll-loop.ts";
export {
  backoffDelayMs,
  createCaptureConsumer,
  DEFAULT_BACKOFF_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_SAMPLE_MS,
  DEFAULT_WAIT_TIME_SECONDS,
  idleDelayMs,
  isFastEmptyPoll,
  isFinalAttempt,
  MAX_BACKOFF_MS,
  MIN_BLOCKING_POLL_MS,
  sampleQueue,
  type CaptureConsumer,
  type CaptureConsumerOptions,
  type ConsumerConfig,
  type ConsumerJob,
  type ConsumerMetrics,
  type ConsumerStopOptions,
  type JobFinishedEvent,
  type JobHandlers,
  type JobOutcome,
  type JobRunContext,
  type KindHandler,
  type QueueSample,
  type RetryConfig,
} from "./consumer/index.ts";
export type { LeaseRenewal, PollableCaptureQueue, PollableJob } from "../adapters/capture-queue.ts";
