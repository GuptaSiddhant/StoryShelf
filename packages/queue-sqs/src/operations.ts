/** Enqueue and remote no-op status views for the SQS capture queue. */
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import type { CaptureJob, QueueEntry } from "@storyshelf/core/adapter/capture-queue";
import type { SqsContext } from "./client.ts";
import { serializeEnqueueBody } from "./codec.ts";

/**
 * Submit a build for capture. Resolves once the message is sent to SQS.
 *
 * The actual capture execution happens in a separate worker that
 * polls the queue and calls `executeCaptureJob`.
 */
export async function enqueueJob(ctx: SqsContext, job: CaptureJob): Promise<void> {
  await ctx.client.send(
    new SendMessageCommand({
      QueueUrl: ctx.queueUrl,
      MessageBody: serializeEnqueueBody(job),
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
}

/**
 * Return the current status entry for a build.
 *
 * For remote queues SQS has no peek; builds table is source of truth.
 * Returns null to signal caller should query the database.
 */
export async function queueStatus(_ctx: SqsContext, _buildId: string): Promise<QueueEntry | null> {
  return await Promise.resolve(null);
}

/**
 * Return queue entries that are queued or running.
 *
 * Remote queues don't track in-queue status server-side; returns empty.
 */
export async function queueActive(_ctx: SqsContext): Promise<QueueEntry[]> {
  return await Promise.resolve([]);
}

/**
 * Return the most recent queue entries.
 *
 * Remote queues don't track history server-side; returns empty.
 */
export async function queueRecent(_ctx: SqsContext, _limit: number): Promise<QueueEntry[]> {
  return await Promise.resolve([]);
}
