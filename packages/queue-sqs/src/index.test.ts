import { ReceiveMessageCommand, SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { describe, expect, it } from "vitest";
import { createSqsCaptureQueue } from "./index.ts";

/** A fake S3 response handler keyed by the command constructor name. */
type Handler = (input: Record<string, unknown>) => unknown;

/** A fake S3 client that records sent commands and returns canned responses. */
function makeClient(handlers: Record<string, Handler> = {}): {
  client: SQSClient;
  sent: string[];
} {
  const sent: string[] = [];
  const send = async (command: {
    constructor: { name: string };
    input: Record<string, unknown>;
  }): Promise<unknown> => {
    sent.push(command.constructor.name);
    const handler = handlers[command.constructor.name];
    return handler ? await handler(command.input) : {};
  };
  return {
    client: { send } as unknown as SQSClient,
    sent,
  };
}

describe("enqueue", () => {
  it("enqueues a job by sending SendMessageCommand", async () => {
    const { client, sent } = makeClient();
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });

    await queue.enqueue({ buildId: "build-1", reqId: "req-1" });

    expect(sent).toContain(SendMessageCommand.name);
  });
});

describe("status", () => {
  it("status returns null when no messages are in the queue", async () => {
    const { client } = makeClient();
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });

    const result = await queue.status("build-1");
    expect(result).toBeNull();
  });

  it("status returns the entry and deletes the message", async () => {
    const { client, sent } = makeClient({
      [ReceiveMessageCommand.name]: () => ({
        Messages: [
          {
            Body: JSON.stringify({
              buildId: "build-1",
              status: "completed",
              queuedAt: new Date().toISOString(),
            }),
            ReceiptHandle: "receipt-1",
          },
        ],
      }),
    });
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });

    const result = await queue.status("build-1");
    expect(result?.buildId).toBe("build-1");
    expect(result?.status).toBe("completed");
    // SendMessage should not be sent (status doesn't enqueue)
    expect(sent).not.toContain(SendMessageCommand.name);
  });
});

describe("active", () => {
  it("active returns queued/running entries", async () => {
    const { client } = makeClient({
      [ReceiveMessageCommand.name]: () => ({
        Messages: [
          {
            Body: JSON.stringify({
              buildId: "build-1",
              status: "queued",
              queuedAt: new Date(Date.now() - 3_600_000).toISOString(),
            }),
            ReceiptHandle: "receipt-1",
          },
          {
            Body: JSON.stringify({
              buildId: "build-2",
              status: "running",
              queuedAt: new Date().toISOString(),
            }),
            ReceiptHandle: "receipt-2",
          },
          {
            Body: JSON.stringify({
              buildId: "build-3",
              status: "completed",
              queuedAt: new Date().toISOString(),
            }),
            ReceiptHandle: "receipt-3",
          },
        ],
      }),
    });
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });

    const result = await queue.active();
    expect(result.length).toBe(2);
    // Newest first: build-2 (now) before build-1 (1 hour ago)
    expect(result.map((entry) => entry.buildId)).toEqual(["build-2", "build-1"]);
  });
});

describe("recent", () => {
  it("recent returns entries sorted newest first", async () => {
    const { client } = makeClient({
      [ReceiveMessageCommand.name]: () => ({
        Messages: [
          {
            Body: JSON.stringify({
              buildId: "build-1",
              status: "queued",
              queuedAt: new Date().toISOString(),
            }),
            ReceiptHandle: "receipt-1",
          },
          {
            Body: JSON.stringify({
              buildId: "build-2",
              status: "queued",
              queuedAt: new Date(Date.now() - 7_200_000).toISOString(),
            }),
            ReceiptHandle: "receipt-2",
          },
        ],
      }),
    });
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });

    const result = await queue.recent(5);
    expect(result.length).toBe(2);
    // Newest first: build-1 should be before build-2
    expect(result.at(0)?.buildId).toBe("build-1");
    expect(result.at(1)?.buildId).toBe("build-2");
  });
});
