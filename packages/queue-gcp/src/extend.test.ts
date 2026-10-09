import type { v1 } from "@google-cloud/pubsub";
import { describe, expect, it } from "vitest";
import { createGcpPubSubQueue } from "./index.ts";

function queueWith(modify: () => void, leaseSeconds?: number) {
  const deadlines: unknown[] = [];
  const subscriber = {
    pull: async () => [
      {
        receivedMessages: [
          {
            ackId: "ack-1",
            deliveryAttempt: 1,
            message: { data: new TextEncoder().encode(JSON.stringify({ buildId: "b" })) },
          },
        ],
      },
    ],
    acknowledge: async () => {},
    modifyAckDeadline: async (request: unknown) => {
      deadlines.push(request);
      modify();
    },
    close: async () => {},
  } as unknown as v1.SubscriberClient;
  const queue = createGcpPubSubQueue({
    topic: "t",
    subscription: "s",
    projectId: "p",
    subscriber,
    publisher: {} as v1.PublisherClient,
    leaseSeconds,
  });
  return { queue, deadlines };
}

describe("extend", () => {
  it("pins the ack deadline at poll time and on renewal", async () => {
    const { queue, deadlines } = queueWith(() => {}, 120);
    const job = (await queue.poll())!;
    expect(job.leaseMs).toBe(120_000);
    expect(await queue.extend!(job)).toBe("ok");
    expect(deadlines).toHaveLength(2);
    expect(deadlines[1]).toMatchObject({ ackIds: ["ack-1"], ackDeadlineSeconds: 120 });
  });

  it("is a no-op without a receipt", async () => {
    const { queue, deadlines } = queueWith(() => {});
    expect(await queue.extend!({ buildId: "b" })).toBe("ok");
    expect(deadlines).toHaveLength(0);
  });

  it("reports INVALID_ARGUMENT as lost and rethrows other errors", async () => {
    let failure: unknown = null;
    const { queue } = queueWith(() => {
      if (failure) {
        throw failure;
      }
    });
    const job = (await queue.poll())!;
    failure = Object.assign(new Error("expired"), { code: 3 });
    expect(await queue.extend!(job)).toBe("lost");
    failure = Object.assign(new Error("unavailable"), { code: 14 });
    await expect(queue.extend!(job)).rejects.toThrow("unavailable");
  });
});
