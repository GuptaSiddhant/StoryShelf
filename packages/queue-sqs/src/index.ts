import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import type {
  CaptureJob,
  PollableCaptureQueue,
  PollableJob,
  QueueEntry,
} from "@storyshelf/core/adapter/capture-queue";
import type { Logger } from "@storyshelf/core/logger";

declare const __PKG_VERSION__: string | undefined;

/**
 * Create an SQS-backed `CaptureQueue` with worker polling.
 *
 * Server side uses `enqueue` only; `status`/`active`/`recent` are no-ops
 * that return empty results (the builds table is the source of truth for remote
 * queues). Workers poll via `poll`/`ack`/`nack` which use SQS long-poll,
 * visibility timeout, and retry counting via `ApproximateReceiveCount`.
 *
 * A separately-assembled worker polls the queue and calls
 * `executeCaptureJob` from `@storyshelf/core`.
 *
 * @param options - SQS queue URL and optional client configuration.
 * @returns A `PollableCaptureQueue` satisfying the core interface.
 */
export function createSqsCaptureQueue(options: SqsCaptureQueueOptions): PollableCaptureQueue {
  const client = options.client ?? new SQSClient({});
  const ownsClient = options.client === undefined;
  let destroyed = false;
  const visibilityTimeout = options.visibilityTimeout ?? 300;
  const waitTimeSeconds = options.waitTimeSeconds ?? 20;
  let boundLogger: Logger | undefined = options.logger;

  return {
    metadata: {
      name: "SQS Queue",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "SQS-backed capture queue",
      kind: "sqs",
      category: "capture-queue",
    },
    setLogger(bound: Logger): void {
      boundLogger ??= bound;
    },
    lifecycle: {
      setup: async () => {
        await client.send(new GetQueueAttributesCommand({ QueueUrl: options.queueUrl }));
      },
      teardown: async () => {
        if (!ownsClient || destroyed) {
          return;
        }
        destroyed = true;
        client.destroy();
      },
      health: async () => {
        await client.send(new GetQueueAttributesCommand({ QueueUrl: options.queueUrl }));
        return { ok: true };
      },
    },
    /**
     * Submit a build for capture. Resolves once the message is sent to SQS.
     *
     * The actual capture execution happens in a separate worker that
     * polls the queue and calls `executeCaptureJob`.
     */
    async enqueue(job: CaptureJob): Promise<void> {
      await client.send(
        new SendMessageCommand({
          QueueUrl: options.queueUrl,
          MessageBody: JSON.stringify({
            buildId: job.buildId,
            reqId: job.reqId,
            queuedAt: new Date().toISOString(),
            status: "queued",
          }),
          MessageAttributes: {
            buildId: {
              DataType: "String",
              StringValue: job.buildId,
            },
            status: {
              DataType: "String",
              StringValue: "queued",
            },
          },
        }),
      );
    },

    /**
     * Return the current status entry for a build.
     *
     * For remote queues SQS has no peek; builds table is source of truth.
     * Returns null to signal caller should query the database.
     */
    async status(_buildId: string): Promise<QueueEntry | null> {
      return null;
    },

    /**
     * Return queue entries that are queued or running.
     *
     * Remote queues don't track in-queue status server-side; returns empty.
     */
    async active(): Promise<QueueEntry[]> {
      return [];
    },

    /**
     * Return the most recent queue entries.
     *
     * Remote queues don't track history server-side; returns empty.
     */
    async recent(_limit: number): Promise<QueueEntry[]> {
      return [];
    },

    /**
     * Poll for a single capture job using SQS long-poll.
     *
     * Uses `ApproximateReceiveCount` to derive attempts (0-indexed).
     */
    async poll(pollOptions?: { waitMs?: number }): Promise<PollableJob | null> {
      const waitSeconds =
        pollOptions?.waitMs !== undefined
          ? Math.max(0, Math.min(20, Math.floor(pollOptions.waitMs / 1000)))
          : waitTimeSeconds;
      const resp = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: options.queueUrl,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: waitSeconds,
          VisibilityTimeout: visibilityTimeout,
          MessageAttributeNames: ["All"],
          MessageSystemAttributeNames: ["ApproximateReceiveCount"],
        }),
      );

      const messages = resp.Messages ?? [];
      if (messages.length === 0) {
        return null;
      }

      const [msg] = messages;
      if (!msg?.Body) {
        return null;
      }

      const body = parseBody(msg.Body);
      if (!body.buildId) {
        // Malformed message: delete and return null
        if (msg.ReceiptHandle) {
          await client
            .send(
              new DeleteMessageCommand({
                QueueUrl: options.queueUrl,
                ReceiptHandle: msg.ReceiptHandle,
              }),
            )
            .catch(() => {});
        }
        boundLogger?.warn({ body: msg.Body }, "received malformed SQS message without buildId");
        return null;
      }

      const rawCount = msg.Attributes?.["ApproximateReceiveCount"];
      const attempts = rawCount ? Math.max(0, Number.parseInt(rawCount, 10) - 1) : 0;

      return {
        buildId: body.buildId,
        reqId: body.reqId,
        receipt: msg.ReceiptHandle,
        attempts,
        raw: msg,
      };
    },

    async ack(job: PollableJob): Promise<void> {
      if (!job.receipt) {
        return;
      }
      await client.send(
        new DeleteMessageCommand({
          QueueUrl: options.queueUrl,
          ReceiptHandle: job.receipt,
        }),
      );
    },

    async nack(
      job: PollableJob,
      nackOptions?: { requeue?: boolean; delayMs?: number },
    ): Promise<void> {
      if (!job.receipt) {
        return;
      }
      if (nackOptions?.requeue === false) {
        await client.send(
          new DeleteMessageCommand({
            QueueUrl: options.queueUrl,
            ReceiptHandle: job.receipt,
          }),
        );
        return;
      }
      const delaySeconds =
        nackOptions?.delayMs !== undefined
          ? Math.max(0, Math.min(43_200, Math.floor(nackOptions.delayMs / 1000)))
          : 0;
      // If delay needed, use ChangeMessageVisibility with new timeout; otherwise make visible immediately (0)
      await client.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: options.queueUrl,
          ReceiptHandle: job.receipt,
          VisibilityTimeout: delaySeconds,
        }),
      );
    },
  };
}

/** Options for configuring an SQS-backed CaptureQueue. */
export interface SqsCaptureQueueOptions {
  /** SQS queue URL. */
  queueUrl: string;
  /** Optional pre-configured SQSClient. */
  client?: SQSClient;
  /** Optional logger for queue diagnostics. */
  logger?: Logger;
  /** Visibility timeout in seconds (default 300). */
  visibilityTimeout?: number;
  /** Long-poll wait time in seconds (default 20, max 20). */
  waitTimeSeconds?: number;
}

interface QueuedBody {
  buildId?: string;
  status?: string;
  queuedAt?: string;
  reqId?: string;
}
function parseBody(raw: string): QueuedBody {
  try {
    return JSON.parse(raw) as QueuedBody;
  } catch {
    return {};
  }
}
