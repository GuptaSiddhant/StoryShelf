/** Worker polling, ack, and nack for the SQS capture queue. */
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  type Message,
} from "@aws-sdk/client-sqs";
import type { PollableJob } from "@storyshelf/core/adapter/capture-queue";
import type { SqsContext } from "./client.ts";
import { parseBody } from "./codec.ts";
import type { QueuedBody } from "./types.ts";

/** Clamp an optional waitMs into the SQS WaitTimeSeconds range (0-20s). */
function clampWaitSeconds(waitMs: number | undefined, fallback: number): number {
  if (waitMs === undefined) {
    return fallback;
  }
  return Math.max(0, Math.min(20, Math.floor(waitMs / 1000)));
}

/** Clamp an optional delayMs into the SQS VisibilityTimeout range (0-43200s). */
function clampNackDelaySeconds(delayMs: number | undefined): number {
  if (delayMs === undefined) {
    return 0;
  }
  return Math.max(0, Math.min(43_200, Math.floor(delayMs / 1000)));
}

/** Derive 0-indexed attempts from the SQS ApproximateReceiveCount attribute. */
function attemptsFromCount(rawCount: string | undefined): number {
  if (!rawCount) {
    return 0;
  }
  return Math.max(0, Math.trunc(Number(rawCount)) - 1);
}

/** Build the polled job view from a received message and its parsed body. */
function buildPolledJob(msg: Message, body: QueuedBody): PollableJob {
  return {
    buildId: body.buildId ?? "",
    reqId: body.reqId,
    receipt: msg.ReceiptHandle,
    attempts: attemptsFromCount(msg.Attributes?.["ApproximateReceiveCount"]),
    raw: msg,
  };
}

/** Delete a malformed message and warn through the host logger. */
async function dropMalformedMessage(ctx: SqsContext, msg: Message): Promise<null> {
  if (msg.ReceiptHandle) {
    await ctx.client
      .send(
        new DeleteMessageCommand({
          QueueUrl: ctx.queueUrl,
          ReceiptHandle: msg.ReceiptHandle,
        }),
      )
      .catch(() => {});
  }
  ctx.logger?.warn({ body: msg.Body }, "received malformed SQS message without buildId");
  return null;
}

/**
 * Poll for a single capture job using SQS long-poll.
 *
 * Uses `ApproximateReceiveCount` to derive attempts (0-indexed).
 */
export async function pollJob(
  ctx: SqsContext,
  pollOptions?: { waitMs?: number },
): Promise<PollableJob | null> {
  const waitSeconds = clampWaitSeconds(pollOptions?.waitMs, ctx.waitTimeSeconds);
  const msg = await receiveFirstMessage(ctx, waitSeconds);
  if (!msg?.Body) {
    return null;
  }
  const body = parseBody(msg.Body);
  if (!body.buildId) {
    return await dropMalformedMessage(ctx, msg);
  }
  return buildPolledJob(msg, body);
}

/** Receive at most one message with long-poll; undefined when the queue is empty. */
async function receiveFirstMessage(
  ctx: SqsContext,
  waitSeconds: number,
): Promise<Message | undefined> {
  const resp = await ctx.client.send(
    new ReceiveMessageCommand({
      QueueUrl: ctx.queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: waitSeconds,
      VisibilityTimeout: ctx.visibilityTimeout,
      MessageAttributeNames: ["All"],
      MessageSystemAttributeNames: ["ApproximateReceiveCount"],
    }),
  );
  const [msg] = resp.Messages ?? [];
  return msg;
}

/** Acknowledge successful processing by deleting the message. */
export async function ackJob(ctx: SqsContext, job: PollableJob): Promise<void> {
  if (!job.receipt) {
    return;
  }
  await ctx.client.send(
    new DeleteMessageCommand({
      QueueUrl: ctx.queueUrl,
      ReceiptHandle: job.receipt,
    }),
  );
}

/** Negatively acknowledge; delete when requeue is false, else reset visibility. */
export async function nackJob(
  ctx: SqsContext,
  job: PollableJob,
  nackOptions?: { requeue?: boolean; delayMs?: number },
): Promise<void> {
  if (!job.receipt) {
    return;
  }
  if (nackOptions?.requeue === false) {
    await ctx.client.send(
      new DeleteMessageCommand({
        QueueUrl: ctx.queueUrl,
        ReceiptHandle: job.receipt,
      }),
    );
    return;
  }
  const delaySeconds = clampNackDelaySeconds(nackOptions?.delayMs);
  // If delay needed, use ChangeMessageVisibility with new timeout; otherwise make visible immediately (0)
  await ctx.client.send(
    new ChangeMessageVisibilityCommand({
      QueueUrl: ctx.queueUrl,
      ReceiptHandle: job.receipt,
      VisibilityTimeout: delaySeconds,
    }),
  );
}
