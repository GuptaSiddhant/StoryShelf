import {
  ServiceBusAdministrationClient,
  ServiceBusClient,
  type ServiceBusReceivedMessage,
  type ServiceBusReceiver,
  type ServiceBusSender,
} from "@azure/service-bus";
import type {
  CaptureJob,
  PollableCaptureQueue,
  PollableJob,
  QueueEntry,
} from "@storyshelf/core/adapter/capture-queue";
import type { Logger } from "@storyshelf/core/logger";
import { parseBody, serializeBody } from "./shared.ts";
import type { QueuedBody } from "./shared.ts";

/** Options for creating an Azure Service Bus-backed capture queue. */
export interface AzureServiceBusQueueOptions {
  /** Service Bus queue name (e.g. `capture-jobs`). */
  queueName: string;
  /** Service Bus connection string. */
  connectionString: string;
  /** Optional pre-configured client, injected for tests. */
  client?: ServiceBusClient;
  /** Optional pre-configured sender, injected for tests. */
  sender?: ServiceBusSender;
  /** Optional pre-configured peek-lock receiver, injected for tests. */
  receiver?: ServiceBusReceiver;
  /** Optional pre-configured administration client, injected for tests. */
  adminClient?: ServiceBusAdministrationClient;
  /** Optional logger for queue diagnostics. */
  logger?: Logger;
  /** Receive wait time in milliseconds for polling (default 30s). */
  waitMs?: number;
}

const DEFAULT_WAIT_MS = 30_000;

/**
 * Create an Azure Service Bus-backed `PollableCaptureQueue`.
 *
 * Messages are received in peek-lock mode and processed by a worker:
 * `ack` completes the message, `nack` abandons it for immediate redelivery.
 * Service Bus has no per-message visibility timeout, so `nack` always
 * re-enqueues immediately (unlike SQS/Storage Queues, `delayMs` is not
 * honored). Every abandon increments `deliveryCount`; past the queue's
 * `maxDeliveryCount` the message is dead-lettered by Service Bus — the Azure
 * equivalent of the SQS + DLQ pattern.
 *
 * `status`/`active`/`recent` return empty results (the builds table is the
 * source of truth for remote queues), mirroring the SQS adapter.
 *
 * @param options - Queue name, connection string, and optional injected clients.
 * @returns A `PollableCaptureQueue` satisfying the core interface.
 */
export function createAzureServiceBusQueue(
  options: AzureServiceBusQueueOptions,
): PollableCaptureQueue {
  const state = createServiceBusState(options);
  return {
    metadata: buildServiceBusMetadata(),
    lifecycle: {
      setup: async () => {
        await setupServiceBus(state);
      },
      teardown: async () => {
        await teardownServiceBus(state);
      },
      health: async () => {
        return await healthServiceBus(state);
      },
    },
    enqueue: async (job: CaptureJob) => {
      await enqueueServiceBus(state, job);
    },
    status: async (buildId: string) => {
      return await serviceBusStatus(buildId);
    },
    active: async () => {
      return await serviceBusActive();
    },
    recent: async (limit: number) => {
      return await serviceBusRecent(limit);
    },
    poll: async (pollOptions?: { waitMs?: number }) => {
      return await pollServiceBus(state, pollOptions);
    },
    ack: async (job: PollableJob) => {
      await ackServiceBus(state, job);
    },
    nack: async (job: PollableJob, nackOptions?: { requeue?: boolean; delayMs?: number }) => {
      await nackServiceBus(state, job, nackOptions);
    },
  };
}

interface ServiceBusState {
  client: ServiceBusClient;
  ownsClient: boolean;
  sender: ServiceBusSender;
  receiver: ServiceBusReceiver;
  adminClient: ServiceBusAdministrationClient;
  waitMs: number;
  queueName: string;
  logger?: Logger;
  destroyed: boolean;
}

function createServiceBusState(options: AzureServiceBusQueueOptions): ServiceBusState {
  const client = options.client ?? new ServiceBusClient(options.connectionString);
  return {
    client,
    ownsClient: options.client === undefined,
    sender: options.sender ?? client.createSender(options.queueName),
    receiver:
      options.receiver ?? client.createReceiver(options.queueName, { receiveMode: "peekLock" }),
    adminClient:
      options.adminClient ?? new ServiceBusAdministrationClient(options.connectionString),
    waitMs: options.waitMs ?? DEFAULT_WAIT_MS,
    queueName: options.queueName,
    logger: options.logger,
    destroyed: false,
  };
}

function buildServiceBusMetadata(): PollableCaptureQueue["metadata"] {
  return {
    name: "Azure Service Bus Queue",
    version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
    description: "Azure Service Bus capture queue with dead-lettering",
    kind: "azure-service-bus",
    category: "capture-queue",
  };
}

async function setupServiceBus(state: ServiceBusState): Promise<void> {
  await state.adminClient.getQueueRuntimeProperties(state.queueName);
}

async function teardownServiceBus(state: ServiceBusState): Promise<void> {
  if (state.destroyed) {
    return;
  }
  state.destroyed = true;
  if (state.ownsClient) {
    await state.client.close();
    return;
  }
  await Promise.allSettled([state.receiver.close(), state.sender.close()]);
}

async function healthServiceBus(state: ServiceBusState): Promise<{ ok: true }> {
  await state.adminClient.getQueueRuntimeProperties(state.queueName);
  return { ok: true };
}

async function enqueueServiceBus(state: ServiceBusState, job: CaptureJob): Promise<void> {
  await state.sender.sendMessages({
    messageId: job.buildId,
    body: serializeBody(job),
    applicationProperties: {
      buildId: job.buildId,
      status: "queued",
    },
  });
}

async function serviceBusStatus(_buildId: string): Promise<QueueEntry | null> {
  await Promise.resolve();
  return null;
}

async function serviceBusActive(): Promise<QueueEntry[]> {
  await Promise.resolve();
  return [];
}

async function serviceBusRecent(_limit: number): Promise<QueueEntry[]> {
  await Promise.resolve();
  return [];
}

/** Normalize a Service Bus message body into a queued-body shape. */
function toQueuedBody(body: unknown): QueuedBody {
  if (typeof body === "string") {
    return parseBody(body);
  }
  if (typeof body === "object" && body !== null) {
    const candidate = body as { buildId?: unknown; reqId?: unknown };
    if (typeof candidate.buildId === "string") {
      const queued: QueuedBody = { buildId: candidate.buildId };
      if (typeof candidate.reqId === "string") {
        queued.reqId = candidate.reqId;
      }
      return queued;
    }
  }
  return {};
}

async function receiveSingleServiceBus(
  receiver: ServiceBusReceiver,
  fullWaitMs: number,
): Promise<ServiceBusReceivedMessage | null> {
  const messages = await receiver.receiveMessages(1, { maxWaitTimeInMs: fullWaitMs });
  const [msg] = messages;
  if (!msg?.body) {
    return null;
  }
  return msg;
}

async function pollServiceBus(
  state: ServiceBusState,
  pollOptions?: { waitMs?: number },
): Promise<PollableJob | null> {
  const fullWaitMs = pollOptions?.waitMs ?? state.waitMs;
  const msg = await receiveSingleServiceBus(state.receiver, fullWaitMs);
  if (!msg) {
    return null;
  }
  const body = toQueuedBody(msg.body);
  if (!body.buildId) {
    await state.receiver.completeMessage(msg).catch(() => {
      // Best effort: the message is already unusable, so ignore completion failures.
    });
    state.logger?.warn(
      { body: msg.body },
      "received malformed Service Bus message without buildId",
    );
    return null;
  }
  return {
    buildId: body.buildId,
    reqId: body.reqId,
    receipt: typeof msg.messageId === "string" ? msg.messageId : undefined,
    attempts: Math.max(0, (msg.deliveryCount ?? 1) - 1),
    raw: msg,
  };
}

function rawServiceBusMessage(job: PollableJob): ServiceBusReceivedMessage | undefined {
  return job.raw as ServiceBusReceivedMessage | undefined;
}

async function ackServiceBus(state: ServiceBusState, job: PollableJob): Promise<void> {
  const msg = rawServiceBusMessage(job);
  if (!msg) {
    return;
  }
  await state.receiver.completeMessage(msg);
}

async function nackServiceBus(
  state: ServiceBusState,
  job: PollableJob,
  nackOptions?: { requeue?: boolean },
): Promise<void> {
  const msg = rawServiceBusMessage(job);
  if (!msg) {
    return;
  }
  if (nackOptions?.requeue === false) {
    await state.receiver.completeMessage(msg);
    return;
  }
  await state.receiver.abandonMessage(msg);
}
