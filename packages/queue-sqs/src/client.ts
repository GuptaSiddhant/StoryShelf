/** SQS client construction/injection and shared queue context. */
import { SQSClient } from "@aws-sdk/client-sqs";
import type { Logger } from "@storyshelf/core/logger";
import type { SqsCaptureQueueOptions } from "./types.ts";

/** Shared SQS request context threaded through lifecycle, operations, and poll. */
export interface SqsContext {
  client: SQSClient;
  queueUrl: string;
  visibilityTimeout: number;
  waitTimeSeconds: number;
  logger?: Logger;
}

/** Resolve the effective client, queue URL, and timeouts for one queue instance. */
export function resolveSqsContext(options: SqsCaptureQueueOptions): {
  ctx: SqsContext;
  ownsClient: boolean;
} {
  const {
    queueUrl,
    client: injectedClient,
    logger,
    visibilityTimeout = 300,
    waitTimeSeconds = 20,
  } = options;
  const client = injectedClient ?? new SQSClient({});
  return {
    ctx: { client, queueUrl, visibilityTimeout, waitTimeSeconds, logger },
    ownsClient: injectedClient === undefined,
  };
}
