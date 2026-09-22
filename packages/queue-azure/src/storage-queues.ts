import { QueueClient, type DequeuedMessageItem } from "@azure/storage-queue";
import type {
  CaptureJob,
  PollableCaptureQueue,
  PollableJob,
  QueueEntry,
} from "@storyshelf/core/adapter/capture-queue";
import type { Logger } from "@storyshelf/core/logger";
import { decodeReceipt, encodeReceipt, parseBody, serializeBody } from "./shared.ts";

/** Options for creating an Azure Storage Queues-backed capture queue. */
export interface AzureStorageQueuesQueueOptions {
  /** Storage queue name (e.g. `capture-jobs`). */
  queueName: string;
  /** Storage account connection string. */
  connectionString: string;
  /** Optional pre-configured QueueClient, injected for tests. */
  client?: QueueClient;
  /** Optional logger for queue diagnostics. */
  logger?: Logger;
  /** Visibility timeout in seconds applied to polled messages (default 300). */
  visibilityTimeout?: number;
  /** HTTP request timeout in milliseconds for polling (default 20s). */
  waitMs?: number;
}

const DEFAULT_VISIBILITY_SECONDS = 300;
const DEFAULT_WAIT_MS = 20_000;
const MAX_VISIBILITY_SECONDS = 604_800;

/**
 * Create an Azure Storage Queues-backed `PollableCaptureQueue`.
 *
 * New messages stay invisible for `visibilityTimeout` seconds after a poll; a
 * successful `ack` deletes them, a `nack` either deletes (when `requeue:
 * false`) or releases them back to the queue — immediately or after `delayMs`.
 * Attempts come from the queue's `dequeueCount`. There is no long-polling on
 * Azure Storage Queues, so `poll` waits at most the HTTP request timeout.
 *
 * `status`/`active`/`recent` return empty results (the builds table is the
 * source of truth for remote queues), mirroring the SQS adapter.
 *
 * @param options - Queue name, connection string, and optional client.
 * @returns A `PollableCaptureQueue` satisfying the core interface.
 */
export function createAzureStorageQueuesQueue(
  options: AzureStorageQueuesQueueOptions,
): PollableCaptureQueue {
  const state = createStorageState(options);
  return {
    metadata: buildStorageMetadata(),
    lifecycle: {
      setup: async () => {
        await setupStorage(state.client);
      },
      teardown: async () => {
        await teardownStorage(state);
      },
      health: async () => {
        return await healthStorage(state.client);
      },
    },
    enqueue: async (job: CaptureJob) => {
      await enqueueStorage(state.client, job);
    },
    status: async (buildId: string) => {
      return await storageStatus(buildId);
    },
    active: async () => {
      return await storageActive();
    },
    recent: async (limit: number) => {
      return await storageRecent(limit);
    },
    poll: async (pollOptions?: { waitMs?: number }) => {
      return await pollStorage(state, pollOptions);
    },
    ack: async (job: PollableJob) => {
      await ackStorage(state.client, job);
    },
    nack: async (job: PollableJob, nackOptions?: { requeue?: boolean; delayMs?: number }) => {
      await nackStorage(state, job, nackOptions);
    },
  };
}

interface StorageQueueState {
  client: QueueClient;
  visibilitySeconds: number;
  waitMs: number;
  logger?: Logger;
  destroyed: boolean;
}

function createStorageState(options: AzureStorageQueuesQueueOptions): StorageQueueState {
  return {
    client: options.client ?? new QueueClient(options.connectionString, options.queueName),
    visibilitySeconds: options.visibilityTimeout ?? DEFAULT_VISIBILITY_SECONDS,
    waitMs: options.waitMs ?? DEFAULT_WAIT_MS,
    logger: options.logger,
    destroyed: false,
  };
}

function buildStorageMetadata(): PollableCaptureQueue["metadata"] {
  return {
    name: "Azure Storage Queues Queue",
    version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
    description: "Azure Storage Queues capture queue",
    kind: "azure-storage-queues",
    category: "capture-queue",
  };
}

/** Wrap a poll's receive in a short-lived abort window. */
function withVisibility(
  client: QueueClient,
  visibilitySeconds: number,
  waitMs: number,
): { receive: () => Promise<DequeuedMessageItem | null>; abort: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, waitMs);
  let cleared = false;
  const settle = (): void => {
    if (cleared) {
      return;
    }
    cleared = true;
    clearTimeout(timer);
  };
  return {
    receive: async () => {
      const response = await client.receiveMessages({
        numberOfMessages: 1,
        visibilityTimeout: visibilitySeconds,
        abortSignal: controller.signal,
      });
      const [msg] = response.receivedMessageItems;
      settle();
      return msg ?? null;
    },
    abort: settle,
  };
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

async function receiveSingle(
  state: StorageQueueState,
  fullWaitMs: number,
): Promise<DequeuedMessageItem | null> {
  const { receive, abort } = withVisibility(state.client, state.visibilitySeconds, fullWaitMs);
  try {
    const msg = await receive();
    if (!msg?.messageText) {
      return null;
    }
    return msg;
  } catch (error) {
    if (isAbortError(error)) {
      return null;
    }
    throw error;
  } finally {
    abort();
  }
}

function toStorageJob(msg: DequeuedMessageItem, buildId: string, reqId?: string): PollableJob {
  return {
    buildId,
    reqId,
    receipt: encodeReceipt(msg.messageId, msg.popReceipt),
    attempts: Math.max(0, (msg.dequeueCount ?? 1) - 1),
    raw: msg,
  };
}

async function discardMalformed(
  client: QueueClient,
  msg: DequeuedMessageItem,
  logger?: Logger,
): Promise<void> {
  await client.deleteMessage(msg.messageId, msg.popReceipt).catch(() => {
    // Best effort: the message is already unusable, so ignore delete failures.
  });
  logger?.warn({ body: msg.messageText }, "received malformed message without buildId");
}

async function pollStorage(
  state: StorageQueueState,
  pollOptions?: { waitMs?: number },
): Promise<PollableJob | null> {
  const fullWaitMs = pollOptions?.waitMs ?? state.waitMs;
  const msg = await receiveSingle(state, fullWaitMs);
  if (!msg?.messageText) {
    return null;
  }
  const body = parseBody(msg.messageText);
  if (!body.buildId) {
    await discardMalformed(state.client, msg, state.logger);
    return null;
  }
  return toStorageJob(msg, body.buildId, body.reqId);
}

async function setupStorage(client: QueueClient): Promise<void> {
  await client.getProperties();
}

async function teardownStorage(state: StorageQueueState): Promise<void> {
  await Promise.resolve();
  if (state.destroyed) {
    return;
  }
  state.destroyed = true;
}

async function healthStorage(client: QueueClient): Promise<{ ok: true }> {
  await client.getProperties();
  return { ok: true };
}

async function enqueueStorage(client: QueueClient, job: CaptureJob): Promise<void> {
  await client.sendMessage(serializeBody(job));
}

async function storageStatus(_buildId: string): Promise<QueueEntry | null> {
  await Promise.resolve();
  return null;
}

async function storageActive(): Promise<QueueEntry[]> {
  await Promise.resolve();
  return [];
}

async function storageRecent(_limit: number): Promise<QueueEntry[]> {
  await Promise.resolve();
  return [];
}

async function ackStorage(client: QueueClient, job: PollableJob): Promise<void> {
  if (!job.receipt) {
    return;
  }
  const { messageId, popReceipt } = decodeReceipt(job.receipt);
  if (!popReceipt) {
    return;
  }
  await client.deleteMessage(messageId, popReceipt);
}

function delaySecondsFor(nackOptions?: { delayMs?: number }): number {
  if (nackOptions?.delayMs === undefined) {
    return 0;
  }
  const clampedMs = Math.max(
    0,
    Math.min(MAX_VISIBILITY_SECONDS * 1000, Math.floor(nackOptions.delayMs)),
  );
  return Math.floor(clampedMs / 1000);
}

async function nackStorage(
  state: StorageQueueState,
  job: PollableJob,
  nackOptions?: { requeue?: boolean; delayMs?: number },
): Promise<void> {
  if (!job.receipt) {
    return;
  }
  const { messageId, popReceipt } = decodeReceipt(job.receipt);
  if (!popReceipt) {
    return;
  }
  if (nackOptions?.requeue === false) {
    await state.client.deleteMessage(messageId, popReceipt);
    return;
  }
  const delaySeconds = delaySecondsFor(nackOptions);
  await state.client.updateMessage(messageId, popReceipt, serializeBody(job), delaySeconds);
}
