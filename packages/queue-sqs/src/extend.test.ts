import { ChangeMessageVisibilityCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { describe, expect, it } from "vitest";
import { createSqsCaptureQueue } from "./index.ts";

const QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs";

function queueWith(send: (input: Record<string, unknown>) => unknown) {
  const inputs: Record<string, unknown>[] = [];
  const client = {
    send: async (command: { input: Record<string, unknown> }) => {
      inputs.push(command.input);
      return await send(command.input);
    },
  } as unknown as SQSClient;
  return {
    queue: createSqsCaptureQueue({ queueUrl: QUEUE_URL, client, visibilityTimeout: 90 }),
    inputs,
  };
}

describe("extend", () => {
  it("resets visibility to the configured timeout", async () => {
    const { queue, inputs } = queueWith(() => ({}));
    expect(await queue.extend!({ buildId: "b", receipt: "r1" })).toBe("ok");
    expect(inputs[0]).toMatchObject({ ReceiptHandle: "r1", VisibilityTimeout: 90 });
    expect(ChangeMessageVisibilityCommand.name).toBe("ChangeMessageVisibilityCommand");
  });

  it("is a no-op without a receipt", async () => {
    const { queue, inputs } = queueWith(() => ({}));
    expect(await queue.extend!({ buildId: "b" })).toBe("ok");
    expect(inputs).toHaveLength(0);
  });

  it.each(["ReceiptHandleIsInvalid", "MessageNotInflight"])("reports %s as lost", async (name) => {
    const { queue } = queueWith(() => {
      throw Object.assign(new Error(name), { name });
    });
    expect(await queue.extend!({ buildId: "b", receipt: "r1" })).toBe("lost");
  });

  it("rethrows transient errors", async () => {
    const { queue } = queueWith(() => {
      throw new Error("Throttling");
    });
    await expect(queue.extend!({ buildId: "b", receipt: "r1" })).rejects.toThrow("Throttling");
  });

  it("grants leaseMs at poll time", async () => {
    const { queue } = queueWith(() => ({
      Messages: [{ Body: JSON.stringify({ buildId: "b" }), ReceiptHandle: "r1" }],
    }));
    expect((await queue.poll())?.leaseMs).toBe(90_000);
  });
});
