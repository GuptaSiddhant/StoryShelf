/** Lifecycle setup/health/teardown tests for the SQS capture queue. */
import { GetQueueAttributesCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { describe, expect, it } from "vitest";
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

describe("createSqsCaptureQueue - lifecycle", () => {
  it("init checks queue attributes", async () => {
    const { client, sent } = makeClient();
    const queue = createSqsCaptureQueue({ queueUrl: QUEUE_URL, client });

    await queue.lifecycle?.setup({} as never);

    expect(sent).toContain(GetQueueAttributesCommand.name);
  });

  it("health returns ok after probing queue attributes", async () => {
    const { client, sent } = makeClient();
    const queue = createSqsCaptureQueue({ queueUrl: QUEUE_URL, client });

    await expect(queue.lifecycle?.health?.()).resolves.toEqual({ ok: true });
    expect(sent).toContain(GetQueueAttributesCommand.name);
  });

  it("teardown is a no-op for injected clients", async () => {
    const { client, sent } = makeClient();
    const queue = createSqsCaptureQueue({ queueUrl: QUEUE_URL, client });

    await queue.lifecycle?.teardown?.();
    await queue.lifecycle?.teardown?.();

    expect(sent).toEqual([]);
  });

  it("teardown destroys owned clients without throwing", async () => {
    const queue = createSqsCaptureQueue({ queueUrl: QUEUE_URL });

    await queue.lifecycle?.teardown?.();
    await expect(queue.lifecycle?.teardown?.()).resolves.toBeUndefined();
  });
});
