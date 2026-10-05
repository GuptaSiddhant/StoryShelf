/** Client construction/injection tests for the SQS capture queue. */
import type { SQSClient } from "@aws-sdk/client-sqs";
import { describe, expect, it } from "vitest";
import { resolveSqsContext } from "./client.ts";
import { createSqsCaptureQueue } from "./index.ts";

const QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs";

/** A fake SQS client that records sent commands and returns canned responses. */
function makeClient(): { client: SQSClient; sent: string[] } {
  const sent: string[] = [];
  const send = async (command: {
    constructor: { name: string };
    input: Record<string, unknown>;
  }): Promise<unknown> => {
    sent.push(command.constructor.name);
    return await Promise.resolve({});
  };
  return { client: { send } as unknown as SQSClient, sent };
}

describe("createSqsCaptureQueue - construct", () => {
  it("constructs a queue without throwing", () => {
    const { client } = makeClient();
    const queue = createSqsCaptureQueue({ queueUrl: QUEUE_URL, client });

    expect(queue).toBeDefined();
    expect(typeof queue.enqueue).toBe("function");
    expect(typeof queue.poll).toBe("function");
  });

  it("has correct metadata", () => {
    const { client } = makeClient();
    const queue = createSqsCaptureQueue({ queueUrl: QUEUE_URL, client });

    expect(queue.metadata.kind).toBe("sqs");
    expect(queue.metadata.category).toBe("capture-queue");
  });
});

describe("resolveSqsContext", () => {
  it("marks injected clients as not owned", () => {
    const { client } = makeClient();

    const { ctx, ownsClient } = resolveSqsContext({ queueUrl: QUEUE_URL, client });

    expect(ctx.queueUrl).toBe(QUEUE_URL);
    expect(ctx.client).toBe(client);
    expect(ownsClient).toBe(false);
  });

  it("applies visibility and wait-time defaults", () => {
    const { client } = makeClient();

    const { ctx } = resolveSqsContext({ queueUrl: QUEUE_URL, client });

    expect(ctx.visibilityTimeout).toBe(300);
    expect(ctx.waitTimeSeconds).toBe(20);
  });

  it("threads custom timeouts and logger through", () => {
    const { client } = makeClient();
    const logger = { warn: (): void => {} };

    const { ctx } = resolveSqsContext({
      queueUrl: QUEUE_URL,
      client,
      visibilityTimeout: 600,
      waitTimeSeconds: 5,
      logger: logger as never,
    });

    expect(ctx.visibilityTimeout).toBe(600);
    expect(ctx.waitTimeSeconds).toBe(5);
    expect(ctx.logger).toBe(logger);
  });

  it("owns clients it constructs", () => {
    const { ctx, ownsClient } = resolveSqsContext({ queueUrl: QUEUE_URL });

    expect(ctx.queueUrl).toBe(QUEUE_URL);
    expect(ownsClient).toBe(true);
    ctx.client.destroy();
  });
});
