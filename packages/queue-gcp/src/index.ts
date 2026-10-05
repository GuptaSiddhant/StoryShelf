/**
 * GCP Pub/Sub-backed capture queue.
 *
 * Composition root: wires client construction, lifecycle, enqueue, and
 * synchronous-pull polling into a `PollableCaptureQueue`. Serialization,
 * resource paths, and per-concern logic live in their own modules.
 */
import type {
  CaptureJob,
  PollableCaptureQueue,
  PollableJob,
} from "@storyshelf/core/adapter/capture-queue";
import type { Logger } from "@storyshelf/core/logger";
import { createPubSubState } from "./client.ts";
import { healthPubSub, setupPubSub, teardownPubSub } from "./lifecycle.ts";
import { enqueuePubSub, pubSubActive, pubSubRecent, pubSubStatus } from "./operations.ts";
import { ackPubSub, nackPubSub, pollPubSub } from "./poll.ts";
import type { GcpPubSubQueueOptions } from "./types.ts";

/**
 * Create a GCP Pub/Sub-backed `PollableCaptureQueue`.
 *
 * Uses synchronous pull (one message per poll — the service holds no
 * long-lived streaming state, mirroring the Storage Queues adapter), so
 * `poll` returns `null` immediately when the subscription is empty.
 * `ack` acknowledges; `nack` redelivers immediately, honors `delayMs` via
 * `modifyAckDeadline`, and drops the message when `requeue: false`.
 * Poison messages dead-letter through the subscription's
 * `deadLetterPolicy` (`maxDeliveryAttempts`) — the GCP analog of the
 * SQS + DLQ pattern. Attempts come from `deliveryAttempt` (1-indexed).
 *
 * `status`/`active`/`recent` return empty results (the builds table is the
 * source of truth for remote queues), mirroring the SQS adapter.
 *
 * @param options - Topic, subscription, project, and optional clients.
 * @returns A `PollableCaptureQueue` satisfying the core interface.
 */
export function createGcpPubSubQueue(options: GcpPubSubQueueOptions): PollableCaptureQueue {
  const state = createPubSubState(options);
  return {
    metadata: buildPubSubMetadata(),
    setLogger(bound: Logger): void {
      state.logger ??= bound;
    },
    lifecycle: {
      setup: async () => {
        await setupPubSub(state);
      },
      teardown: async () => {
        await teardownPubSub(state);
      },
      health: async () => {
        return await healthPubSub(state);
      },
    },
    enqueue: async (job: CaptureJob) => {
      await enqueuePubSub(state, job);
    },
    status: async (buildId: string) => {
      return await pubSubStatus(buildId);
    },
    active: async () => {
      return await pubSubActive();
    },
    recent: async (limit: number) => {
      return await pubSubRecent(limit);
    },
    poll: async () => {
      return await pollPubSub(state);
    },
    ack: async (job: PollableJob) => {
      await ackPubSub(state, job);
    },
    nack: async (job: PollableJob, nackOptions?: { requeue?: boolean; delayMs?: number }) => {
      await nackPubSub(state, job, nackOptions);
    },
  };
}

function buildPubSubMetadata(): PollableCaptureQueue["metadata"] {
  return {
    name: "GCP Pub/Sub Queue",
    version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
    description: "GCP Pub/Sub capture queue with dead-lettering",
    kind: "gcp-pubsub",
    category: "capture-queue",
  };
}

export type { GcpPubSubQueueOptions } from "./types.ts";
