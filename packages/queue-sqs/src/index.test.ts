import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from "@aws-sdk/client-sqs";
import { describe, expect, it } from "vitest";
import { createSqsCaptureQueue } from "./index.ts";

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
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });

    await queue.enqueue({ buildId: "build-1", reqId: "req-1" });

    expect(sent).toContain(SendMessageCommand.name);
  });

  it("includes buildId and status in MessageAttributes", async () => {
    const { client, inputs } = makeClient();
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });
    await queue.enqueue({ buildId: "build-42" });
    const input = inputs[0] as { MessageAttributes?: Record<string, { StringValue: string }> };
    expect(input.MessageAttributes?.["buildId"]?.StringValue).toBe("build-42");
    expect(input.MessageAttributes?.["status"]?.StringValue).toBe("queued");
  });

  it("serializes queuedAt and buildId in MessageBody", async () => {
    const { client, inputs } = makeClient();
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });
    await queue.enqueue({ buildId: "build-1" });
    const body = JSON.parse((inputs[0] as { MessageBody: string }).MessageBody) as Record<
      string,
      unknown
    >;
    expect(body["buildId"]).toBe("build-1");
    expect(typeof body["queuedAt"]).toBe("string");
  });
});

describe("metadata and lifecycle", () => {
  it("has correct metadata", () => {
    const { client } = makeClient();
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });
    expect(queue.metadata.kind).toBe("sqs");
    expect(queue.metadata.category).toBe("capture-queue");
  });

  it("init checks queue attributes", async () => {
    const { client, sent } = makeClient();
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });
    await queue.lifecycle?.init?.({} as never);
    expect(sent).toContain(GetQueueAttributesCommand.name);
  });
});

describe("status/active/recent", () => {
  it("status returns null (DB is source of truth)", async () => {
    const { client } = makeClient();
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });

    const result = await queue.status("build-1");
    expect(result).toBeNull();
  });

  it("active returns empty array", async () => {
    const { client } = makeClient();
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });

    const result = await queue.active();
    expect(result).toEqual([]);
  });

  it("recent returns empty array", async () => {
    const { client } = makeClient();
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });

    const result = await queue.recent(5);
    expect(result).toEqual([]);
  });
});

describe("poll", () => {
  it("returns null when no messages", async () => {
    const { client } = makeClient({
      [ReceiveMessageCommand.name]: () => ({ Messages: [] }),
    });
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });

    const job = await queue.poll();
    expect(job).toBeNull();
  });

  it("returns null when message has no Body", async () => {
    const { client } = makeClient({
      [ReceiveMessageCommand.name]: () => ({ Messages: [{ ReceiptHandle: "r1" }] }),
    });
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });
    expect(await queue.poll()).toBeNull();
  });

  it("returns null when Body is empty", async () => {
    const { client } = makeClient({
      [ReceiveMessageCommand.name]: () => ({ Messages: [{ Body: "", ReceiptHandle: "r1" }] }),
    });
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });
    // Empty body is falsy, should return null
    const job = await queue.poll();
    expect(job).toBeNull();
  });

  it("handles malformed JSON body", async () => {
    const { client, sent } = makeClient({
      [ReceiveMessageCommand.name]: () => ({
        Messages: [
          { Body: "not-json", ReceiptHandle: "r1", Attributes: { ApproximateReceiveCount: "1" } },
        ],
      }),
    });
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });
    const job = await queue.poll();
    expect(job).toBeNull();
    expect(sent).toContain(DeleteMessageCommand.name);
  });

  it("returns job with attempts derived from ApproximateReceiveCount", async () => {
    const { client } = makeClient({
      [ReceiveMessageCommand.name]: () => ({
        Messages: [
          {
            Body: JSON.stringify({ buildId: "build-1", reqId: "req-1" }),
            ReceiptHandle: "receipt-1",
            Attributes: { ApproximateReceiveCount: "3" },
          },
        ],
      }),
    });
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });

    const job = await queue.poll();
    expect(job?.buildId).toBe("build-1");
    expect(job?.reqId).toBe("req-1");
    expect(job?.receipt).toBe("receipt-1");
    expect(job?.attempts).toBe(2);
  });

  it("defaults attempts to 0 when ApproximateReceiveCount missing", async () => {
    const { client } = makeClient({
      [ReceiveMessageCommand.name]: () => ({
        Messages: [{ Body: JSON.stringify({ buildId: "build-1" }), ReceiptHandle: "r1" }],
      }),
    });
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });
    const job = await queue.poll();
    expect(job?.attempts).toBe(0);
  });

  it("handles ApproximateReceiveCount 1 as attempts 0", async () => {
    const { client } = makeClient({
      [ReceiveMessageCommand.name]: () => ({
        Messages: [
          {
            Body: JSON.stringify({ buildId: "b1" }),
            ReceiptHandle: "r1",
            Attributes: { ApproximateReceiveCount: "1" },
          },
        ],
      }),
    });
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });
    expect((await queue.poll())?.attempts).toBe(0);
  });

  it("clamps waitMs to 0-20 seconds", async () => {
    const { client, inputs } = makeClient({
      [ReceiveMessageCommand.name]: () => ({ Messages: [] }),
    });
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });
    await queue.poll({ waitMs: -5000 });
    expect((inputs[0] as { WaitTimeSeconds: number }).WaitTimeSeconds).toBe(0);
    await queue.poll({ waitMs: 50_000 });
    expect((inputs[1] as { WaitTimeSeconds: number }).WaitTimeSeconds).toBe(20);
  });

  it("uses custom visibilityTimeout and waitTimeSeconds", async () => {
    const { client, inputs } = makeClient({
      [ReceiveMessageCommand.name]: () => ({ Messages: [] }),
    });
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
      visibilityTimeout: 600,
      waitTimeSeconds: 5,
    });
    await queue.poll();
    expect((inputs[0] as { VisibilityTimeout: number }).VisibilityTimeout).toBe(600);
    expect((inputs[0] as { WaitTimeSeconds: number }).WaitTimeSeconds).toBe(5);
  });

  it("deletes malformed message without buildId", async () => {
    const { client, sent } = makeClient({
      [ReceiveMessageCommand.name]: () => ({
        Messages: [
          {
            Body: JSON.stringify({ foo: "bar" }),
            ReceiptHandle: "receipt-1",
            Attributes: { ApproximateReceiveCount: "1" },
          },
        ],
      }),
    });
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });

    const job = await queue.poll();
    expect(job).toBeNull();
    expect(sent).toContain(DeleteMessageCommand.name);
  });

  it("includes raw message in poll result", async () => {
    const { client } = makeClient({
      [ReceiveMessageCommand.name]: () => ({
        Messages: [
          {
            Body: JSON.stringify({ buildId: "b1" }),
            ReceiptHandle: "r1",
            Attributes: { ApproximateReceiveCount: "1" },
          },
        ],
      }),
    });
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });
    const job = await queue.poll();
    expect(job?.raw).toBeDefined();
  });
});

describe("ack", () => {
  it("ack deletes message", async () => {
    const { client, sent } = makeClient({
      [ReceiveMessageCommand.name]: () => ({
        Messages: [
          {
            Body: JSON.stringify({ buildId: "build-1" }),
            ReceiptHandle: "receipt-1",
            Attributes: { ApproximateReceiveCount: "1" },
          },
        ],
      }),
    });
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });

    const job = await queue.poll();
    expect(job).not.toBeNull();
    await queue.ack(job!);
    expect(sent).toContain(DeleteMessageCommand.name);
  });

  it("ack without receipt does nothing", async () => {
    const { client, sent } = makeClient();
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });
    await queue.ack({ buildId: "b1" });
    expect(sent).not.toContain(DeleteMessageCommand.name);
  });
});

describe("nack", () => {
  it("nack with requeue changes visibility", async () => {
    const { client, sent } = makeClient({
      [ReceiveMessageCommand.name]: () => ({
        Messages: [
          {
            Body: JSON.stringify({ buildId: "build-1" }),
            ReceiptHandle: "receipt-1",
            Attributes: { ApproximateReceiveCount: "1" },
          },
        ],
      }),
    });
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });

    const job = await queue.poll();
    await queue.nack(job!, { requeue: true, delayMs: 2000 });
    expect(sent).toContain(ChangeMessageVisibilityCommand.name);
  });

  it("nack without options changes visibility with 0 delay", async () => {
    const { client, sent, inputs } = makeClient({
      [ReceiveMessageCommand.name]: () => ({
        Messages: [
          {
            Body: JSON.stringify({ buildId: "build-1" }),
            ReceiptHandle: "receipt-1",
            Attributes: { ApproximateReceiveCount: "1" },
          },
        ],
      }),
    });
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });
    const job = await queue.poll();
    await queue.nack(job!, {});
    expect(sent).toContain(ChangeMessageVisibilityCommand.name);
    const lastInput = inputs[inputs.length - 1] as { VisibilityTimeout: number };
    expect(lastInput.VisibilityTimeout).toBe(0);
  });

  it("nack clamps delayMs to 0-43200", async () => {
    const { client, inputs } = makeClient({
      [ReceiveMessageCommand.name]: () => ({
        Messages: [
          {
            Body: JSON.stringify({ buildId: "build-1" }),
            ReceiptHandle: "receipt-1",
            Attributes: { ApproximateReceiveCount: "1" },
          },
        ],
      }),
    });
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });
    const job = await queue.poll();
    await queue.nack(job!, { requeue: true, delayMs: -100 });
    expect((inputs[inputs.length - 1] as { VisibilityTimeout: number }).VisibilityTimeout).toBe(0);
    await queue.nack(job!, { requeue: true, delayMs: 100_000_000 });
    expect((inputs[inputs.length - 1] as { VisibilityTimeout: number }).VisibilityTimeout).toBe(
      43_200,
    );
  });

  it("nack with requeue false deletes message", async () => {
    const { client, sent } = makeClient({
      [ReceiveMessageCommand.name]: () => ({
        Messages: [
          {
            Body: JSON.stringify({ buildId: "build-1" }),
            ReceiptHandle: "receipt-1",
            Attributes: { ApproximateReceiveCount: "3" },
          },
        ],
      }),
    });
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });

    const job = await queue.poll();
    await queue.nack(job!, { requeue: false });
    expect(sent).toContain(DeleteMessageCommand.name);
  });

  it("nack without receipt does nothing", async () => {
    const { client, sent } = makeClient();
    const queue = createSqsCaptureQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
      client,
    });
    await queue.nack({ buildId: "b1" }, { requeue: true });
    expect(sent).not.toContain(ChangeMessageVisibilityCommand.name);
    expect(sent).not.toContain(DeleteMessageCommand.name);
  });
});
