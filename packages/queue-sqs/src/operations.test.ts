/** Enqueue and remote no-op status tests for the SQS capture queue. */
import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { describe, expect, it } from "vitest";
import { createSqsCaptureQueue } from "./index.ts";

const QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs";

/** A fake SQS response handler keyed by the command constructor name. */
type Handler = (input: Record<string, unknown>) => unknown;

/** A fake SQS client that records sent commands and returns canned responses. */
function makeClient(handlers: Record<string, Handler> = {}): {
  client: SQSClient;
  sent: string[];
  inputs: Record<string, unknown>[];
} {
  const sent: string[] = [];
  const inputs: Record<string, unknown>[] = [];
  const send = async (command: {
    constructor: { name: string };
    input: Record<string, unknown>;
  }): Promise<unknown> => {
    sent.push(command.constructor.name);
    inputs.push(command.input);
    const handler = handlers[command.constructor.name];
    return handler ? await handler(command.input) : {};
  };
  return {
    client: { send } as unknown as SQSClient,
    sent,
    inputs,
  };
}

describe("enqueue", () => {
  it("enqueues a job by sending SendMessageCommand", async () => {
    const { client, sent } = makeClient();
    const queue = createSqsCaptureQueue({ queueUrl: QUEUE_URL, client });

    await queue.enqueue({ buildId: "build-1", reqId: "req-1" });

    expect(sent).toContain(SendMessageCommand.name);
  });

  it("includes buildId and status in MessageAttributes", async () => {
    const { client, inputs } = makeClient();
    const queue = createSqsCaptureQueue({ queueUrl: QUEUE_URL, client });

    await queue.enqueue({ buildId: "build-42" });

    const input = inputs[0] as { MessageAttributes?: Record<string, { StringValue: string }> };
    expect(input.MessageAttributes?.["buildId"]?.StringValue).toBe("build-42");
    expect(input.MessageAttributes?.["status"]?.StringValue).toBe("queued");
  });

  it("serializes queuedAt and buildId in MessageBody", async () => {
    const { client, inputs } = makeClient();
    const queue = createSqsCaptureQueue({ queueUrl: QUEUE_URL, client });

    await queue.enqueue({ buildId: "build-1" });

    const body = JSON.parse((inputs[0] as { MessageBody: string }).MessageBody) as Record<
      string,
      unknown
    >;
    expect(body["buildId"]).toBe("build-1");
    expect(typeof body["queuedAt"]).toBe("string");
  });
});

describe("status/active/recent", () => {
  it("status returns null (DB is source of truth)", async () => {
    const { client } = makeClient();
    const queue = createSqsCaptureQueue({ queueUrl: QUEUE_URL, client });

    const result = await queue.status("build-1");

    expect(result).toBeNull();
  });

  it("active returns empty array", async () => {
    const { client } = makeClient();
    const queue = createSqsCaptureQueue({ queueUrl: QUEUE_URL, client });

    const result = await queue.active();

    expect(result).toEqual([]);
  });

  it("recent returns empty array", async () => {
    const { client } = makeClient();
    const queue = createSqsCaptureQueue({ queueUrl: QUEUE_URL, client });

    const result = await queue.recent(5);

    expect(result).toEqual([]);
  });
});
