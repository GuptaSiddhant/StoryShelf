/**
 * Remote capture worker: polls a `CaptureQueue` and runs the capture pipeline.
 *
 * The worker is transport-agnostic: any `PollableCaptureQueue` (SQS today,
 * Redis/Kafka tomorrow) can be supplied. The capture itself is delegated to a
 * pure `CaptureRunner` (e.g. `createPlaywrightCaptureRunner`). Remote workers
 * share the server's `DatabaseAdapter` + `StorageAdapter` (Turso/S3 for remote).
 *
 * ```ts
 * import { createCaptureWorker } from "@storyshelf/worker";
 * import { createTursoDatabase } from "@storyshelf/db-turso";
 * import { createS3Storage } from "@storyshelf/storage-s3";
 * import { createSqsCaptureQueue } from "@storyshelf/queue-sqs";
 * import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";
 *
 * const queue = createSqsCaptureQueue({ queueUrl: process.env.QUEUE_URL! });
 * const worker = createCaptureWorker({
 *   queue,
 *   db: createTursoDatabase({ url: process.env.TURSO_URL!, authToken: process.env.TURSO_AUTH_TOKEN }),
 *   storage: createS3Storage({ bucket: process.env.S3_BUCKET! }),
 *   runner: createPlaywrightCaptureRunner(),
 *   scratchDir: "/tmp/shelf",
 * });
 * await worker.start();
 * // on SIGTERM: await worker.stop();
 * ```
 */

import { createCaptureWorker } from "./worker.ts";

export { createCaptureWorker } from "./worker.ts";
export type { WorkerHandle, WorkerOptions, WorkerTables } from "./worker.ts";
export { DEFAULT_WORKER_CONFIG, resolveWorkerConfig, type WorkerConfig } from "./config.ts";
export default createCaptureWorker;
