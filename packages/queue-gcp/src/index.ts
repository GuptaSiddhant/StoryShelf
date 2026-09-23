import { v1 } from "@google-cloud/pubsub";
import type {
  CaptureJob,
  PollableCaptureQueue,
  PollableJob,
  QueueEntry,
} from "@storyshelf/core/adapter/capture-queue";
import type { Logger } from "@storyshelf/core/logger";

/** Options for creating a GCP Pub/Sub-backed capture queue. */
export interface GcpPubSubQueueOptions {
  /** Pub/Sub topic short name (e.g. `capture-jobs`). */
  topic: string;
  /** Pull subscription short name (e.g. `capture-jobs-worker`). */
  subscription: string;
  /** GCP project ID. */
  projectId: string;
  /** Optional pre-configured publisher client, injected for tests. */
  publisher?: v1.PublisherClient;
  /** Optional pre-configured subscriber client, injected for tests. */
  subscriber?: v1.SubscriberClient;
  /** Optional logger for queue diagnostics. */
  logger?: Logger;
  /** Custom API endpoint (Pub/Sub emulator host). */
  apiEndpoint?: string;
  /** Path to a service-account JSON key file. */
  keyFilename?: string;
}

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

interface GcpPubSubState {
  projectId: string;
  topic: string;
  subscription: string;
  publisher: v1.PublisherClient;
  subscriber: v1.SubscriberClient;
  ownsPublisher: boolean;
  ownsSubscriber: boolean;
  logger?: Logger;
  destroyed: boolean;
}

/** Body stored in a Pub/Sub message. */
interface QueuedBody {
  buildId?: string;
  reqId?: string;
  queuedAt?: string;
  status?: string;
}

function createPubSubState(options: GcpPubSubQueueOptions): GcpPubSubState {
  const clientOptions = {
    projectId: options.projectId,
    apiEndpoint: options.apiEndpoint,
    keyFilename: options.keyFilename,
  };
  const publisher = options.publisher ?? new v1.PublisherClient(clientOptions);
  const subscriber = options.subscriber ?? new v1.SubscriberClient(clientOptions);
  return {
    projectId: options.projectId,
    topic: options.topic,
    subscription: options.subscription,
    publisher,
    subscriber,
    ownsPublisher: options.publisher === undefined,
    ownsSubscriber: options.subscriber === undefined,
    logger: options.logger,
    destroyed: false,
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

function topicPath(projectId: string, topic: string): string {
  return `projects/${projectId}/topics/${topic}`;
}

function subscriptionPath(projectId: string, subscription: string): string {
  return `projects/${projectId}/subscriptions/${subscription}`;
}

/** Serialize a capture job into a Pub/Sub message body (JSON, no newlines). */
function serializeBody(job: CaptureJob): string {
  return JSON.stringify({
    buildId: job.buildId,
    reqId: job.reqId,
    queuedAt: new Date().toISOString(),
    status: "queued",
  });
}

/** Parse a Pub/Sub message body, tolerant of malformed input. */
function parseBody(raw: string): QueuedBody {
  try {
    const parsed = JSON.parse(raw) as QueuedBody;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function decodeData(data: Uint8Array | string): string {
  return typeof data === "string" ? data : new TextDecoder().decode(data);
}

function encodeData(body: string): Uint8Array {
  return new TextEncoder().encode(body);
}

async function setupPubSub(state: GcpPubSubState): Promise<void> {
  await state.publisher.getTopic({ topic: topicPath(state.projectId, state.topic) });
}

async function teardownPubSub(state: GcpPubSubState): Promise<void> {
  if (state.destroyed) {
    return;
  }
  state.destroyed = true;
  const pending: Promise<unknown>[] = [];
  if (state.ownsPublisher) {
    pending.push(state.publisher.close());
  }
  if (state.ownsSubscriber) {
    pending.push(state.subscriber.close());
  }
  await Promise.allSettled(pending);
}

async function healthPubSub(state: GcpPubSubState): Promise<{ ok: true }> {
  await state.subscriber.getSubscription({
    subscription: subscriptionPath(state.projectId, state.subscription),
  });
  return { ok: true };
}

async function enqueuePubSub(state: GcpPubSubState, job: CaptureJob): Promise<void> {
  await state.publisher.publish({
    topic: topicPath(state.projectId, state.topic),
    messages: [
      {
        data: encodeData(serializeBody(job)),
        attributes: { buildId: job.buildId },
      },
    ],
  });
}

async function pubSubStatus(_buildId: string): Promise<QueueEntry | null> {
  await Promise.resolve();
  return null;
}

async function pubSubActive(): Promise<QueueEntry[]> {
  await Promise.resolve();
  return [];
}

async function pubSubRecent(_limit: number): Promise<QueueEntry[]> {
  await Promise.resolve();
  return [];
}

async function discardMalformed(state: GcpPubSubState, ackId: string, raw: string): Promise<void> {
  await state.subscriber
    .acknowledge({
      subscription: subscriptionPath(state.projectId, state.subscription),
      ackIds: [ackId],
    })
    .catch(() => {
      // Best effort: the message is already unusable, so ignore ack failures.
    });
  state.logger?.warn({ body: raw }, "received malformed Pub/Sub message without buildId");
}

async function pollPubSub(state: GcpPubSubState): Promise<PollableJob | null> {
  const pulled = await receiveSingle(state);
  if (!pulled) {
    return null;
  }
  const body = parseBody(pulled.raw);
  if (!body.buildId || !pulled.ackId) {
    await discardUnusable(state, pulled);
    return null;
  }
  return {
    buildId: body.buildId,
    reqId: body.reqId,
    receipt: pulled.ackId,
    attempts: Math.max(0, (pulled.deliveryAttempt ?? 1) - 1),
    raw: pulled.received,
  };
}

interface PulledMessage {
  ackId?: string | null;
  deliveryAttempt?: number | null;
  raw: string;
  received: unknown;
}

async function receiveSingle(state: GcpPubSubState): Promise<PulledMessage | null> {
  const [response] = await state.subscriber.pull({
    subscription: subscriptionPath(state.projectId, state.subscription),
    maxMessages: 1,
  });
  const [received] = response.receivedMessages ?? [];
  const data = received?.message?.data;
  if (!data || data.length === 0) {
    return null;
  }
  return {
    ackId: received.ackId,
    deliveryAttempt: received.deliveryAttempt,
    raw: decodeData(data),
    received,
  };
}

async function discardUnusable(state: GcpPubSubState, pulled: PulledMessage): Promise<void> {
  if (pulled.ackId) {
    await discardMalformed(state, pulled.ackId, pulled.raw);
  } else {
    state.logger?.warn({ body: pulled.raw }, "received Pub/Sub message without ackId");
  }
}

async function ackPubSub(state: GcpPubSubState, job: PollableJob): Promise<void> {
  if (!job.receipt) {
    return;
  }
  await state.subscriber.acknowledge({
    subscription: subscriptionPath(state.projectId, state.subscription),
    ackIds: [job.receipt],
  });
}

function delaySecondsFor(nackOptions?: { delayMs?: number }): number | undefined {
  if (nackOptions?.delayMs === undefined) {
    return undefined;
  }
  return Math.max(0, Math.ceil(nackOptions.delayMs / 1000));
}

async function nackPubSub(
  state: GcpPubSubState,
  job: PollableJob,
  nackOptions?: { requeue?: boolean; delayMs?: number },
): Promise<void> {
  if (!job.receipt) {
    return;
  }
  const subscription = subscriptionPath(state.projectId, state.subscription);
  if (nackOptions?.requeue === false) {
    await state.subscriber.acknowledge({ subscription, ackIds: [job.receipt] });
    return;
  }
  const delaySeconds = delaySecondsFor(nackOptions);
  await state.subscriber.modifyAckDeadline({
    subscription,
    ackIds: [job.receipt],
    ackDeadlineSeconds: delaySeconds ?? 0,
  });
}
