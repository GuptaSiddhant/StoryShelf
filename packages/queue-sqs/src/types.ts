import type { SQSClient } from "@aws-sdk/client-sqs";
import type { Logger } from "@storyshelf/core/logger";

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

/** Shape of the JSON payload stored in the SQS MessageBody. */
export interface QueuedBody {
  buildId?: string;
  status?: string;
  queuedAt?: string;
  reqId?: string;
}
