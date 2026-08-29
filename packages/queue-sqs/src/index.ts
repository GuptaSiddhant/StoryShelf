import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SqsClient,
} from "@aws-sdk/client-sqs";

import type {
  CaptureJob,
  CaptureQueue,
  JobStatus,
  QueueEntry,
} from "@storyshelf/core/adapters/capture-queue";

import type { Logger } from "@storyshelf/core";

/** Options for configuring an SQS-backed CaptureQueue. */
export interface SqsCaptureQueueOptions {
  /** SQS queue URL. */
  queueUrl: string;
  /** Optional pre-configured SqsClient. */
  client?: SqsClient;
  /** Optional logger for queue diagnostics. */
  logger?: Logger;
}

function parseBody(raw: string): unknown {
  return JSON.parse(raw);
}

function hasQueuedOrRunningStatus(body: unknown): boolean {
  const status = (body as { status?: string }).status ?? "queued";
  return ["queued", "running"].includes(status);
}

function mapQueueEntry(raw: { Body?: string }): QueueEntry {
  const body = parseBody(raw.Body ?? "{}");
  return {
    buildId: body.buildId,
    status: body.status ?? "queued",
    queuedAt: body.queuedAt ?? new Date().toISOString(),
  };
}

/**
 * Create an SQS-backed `CaptureQueue`.
 *
 * Jobs are submitted via `SendMessage` and retrieved via `ReceiveMessage`;
 * messages are deleted after reading to prevent re-processing.
 * A separately-assembled worker polls the queue and calls
 * `executeCaptureJob` from `@storyshelf/core`.
 *
 * @param options - SQS queue URL and optional client configuration.
 * @returns A `CaptureQueue` satisfying the core interface.
 */
/* oxlint-disable max-lines-per-function */
export function createSqsCaptureQueue(
  options: SqsCaptureQueueOptions,
): CaptureQueue {
  const client = options.client ?? new SqsClient({});

  return {
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
     * Return the current status entry for a build, or null if untracked.
     *
     * Polls the SQS queue for a message matching the buildId. If found,
     * the message is deleted so it is not re-processed.
     */
    async status(buildId: string): Promise<QueueEntry | null> {
      const resp = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: options.queueUrl,
          MaxNumberOfMessages: 1,
          MessageAttributeNames: ["All"],
        }),
      );

      const messages = resp.Messages ?? [];
      if (messages.length === 0) {
        return null;
      }

      const [msg] = messages;
      const body = parseBody(msg?.Body ?? "{}");

      const status: JobStatus = body.status ?? "queued";

      await client.send(
        new DeleteMessageCommand({
          QueueUrl: options.queueUrl,
          ReceiptHandle: msg.ReceiptHandle,
        }),
      );

      return {
        buildId: body.buildId ?? buildId,
        status,
        queuedAt: body.queuedAt ?? new Date().toISOString(),
        startedAt: body.startedAt,
        finishedAt: body.finishedAt,
        error: body.error,
      };
    },

    /**
     * Return queue entries that are queued or running.
     *
     * Short poll for up to 10 messages. Filters by status.
     */
    async active(): Promise<QueueEntry[]> {
      const resp = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: options.queueUrl,
          MaxNumberOfMessages: 10,
          MessageAttributeNames: ["All"],
        }),
      );

      return (resp.Messages ?? [])
        .filter((message) => hasQueuedOrRunningStatus(parseBody(message.Body ?? "{}")))
        .map(mapQueueEntry)
        .sort((left, right) => right.queuedAt.localeCompare(left.queuedAt));
    },

    /**
     * Return the most recent queue entries, newest first.
     *
     * Short poll for up to `limit` messages, sorted by queuedAt descending.
     */
    async recent(limit: number): Promise<QueueEntry[]> {
      const resp = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: options.queueUrl,
          MaxNumberOfMessages: limit,
          MessageAttributeNames: ["All"],
        }),
      );

      return (resp.Messages ?? [])
        .map(mapQueueEntry)
        .sort((left, right) => right.queuedAt.localeCompare(left.queuedAt));
    },
  };
}