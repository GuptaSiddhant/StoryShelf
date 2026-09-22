/**
 * Azure capture job queue adapter for StoryShelf.
 *
 * The primary export {@link createAzureQueue} is an async dispatcher that
 * selects an Azure queue backend at call time. The two backends are also
 * published as synchronous subpath exports:
 *
 * - `@storyshelf/queue-azure/storage-queues` — {@link createAzureStorageQueuesQueue},
 *   simple visibility-timeout semantics, testable against the Azurite emulator;
 * - `@storyshelf/queue-azure/service-bus` — {@link createAzureServiceBusQueue},
 *   native dead-lettering for SQS + DLQ parity.
 *
 * Both Azure SDK packages are **optional peer dependencies**: install only the
 * one you use. The dispatcher never loads a backend's SDK until that backend is
 * selected, so importing `@storyshelf/queue-azure` is safe without either SDK.
 */

import type {
  PollableCaptureQueue,
  CaptureJob,
  PollableJob,
  QueueEntry,
} from "@storyshelf/core/adapter/capture-queue";
import type { AzureServiceBusQueueOptions } from "./service-bus.ts";
import type { AzureStorageQueuesQueueOptions } from "./storage-queues.ts";

/** The Azure queue backends supported by this package. */
export type AzureQueueBackend = "storage-queues" | "service-bus";

/** Options for {@link createAzureQueue}, keyed by backend. */
export type AzureQueueOptions =
  | ({ backend: "storage-queues" } & AzureStorageQueuesQueueOptions)
  | ({ backend: "service-bus" } & AzureServiceBusQueueOptions);

/**
 * Create an Azure-backed `PollableCaptureQueue`, selecting the backend at
 * runtime. Prefer the synchronous subpath factories when the backend is known
 * at build time:
 *
 * ```ts
 * const queue = await createAzureQueue({
 *   backend: "storage-queues",
 *   queueName: "capture-jobs",
 *   connectionString: process.env.AZURE_STORAGE_CONNECTION!,
 * });
 * ```
 *
 * @param options - Backend choice plus that backend's options.
 * @returns A `PollableCaptureQueue` for the selected backend.
 */
export async function createAzureQueue(options: AzureQueueOptions): Promise<PollableCaptureQueue> {
  if (options.backend === "storage-queues") {
    const { createAzureStorageQueuesQueue } = await import("./storage-queues.ts");
    return createAzureStorageQueuesQueue(options);
  }
  if (options.backend === "service-bus") {
    const { createAzureServiceBusQueue } = await import("./service-bus.ts");
    return createAzureServiceBusQueue(options);
  }
  throw new Error(`unknown azure queue backend '${(options as { backend?: string }).backend}'`);
}

export type { PollableCaptureQueue, CaptureJob, PollableJob, QueueEntry };
export type { AzureServiceBusQueueOptions } from "./service-bus.ts";
export type { AzureStorageQueuesQueueOptions } from "./storage-queues.ts";
