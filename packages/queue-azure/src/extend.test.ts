import type { ServiceBusAdministrationClient, ServiceBusReceiver } from "@azure/service-bus";
import type { QueueClient } from "@azure/storage-queue";
import { describe, expect, it } from "vitest";
import { createAzureServiceBusQueue } from "./service-bus.ts";
import { createAzureStorageQueuesQueue } from "./storage-queues.ts";

function makeStorage(update: () => unknown) {
  const updates: unknown[][] = [];
  const client = {
    receiveMessages: async () => ({
      receivedMessageItems: [
        {
          messageId: "m1",
          popReceipt: "pr1",
          dequeueCount: 1,
          messageText: JSON.stringify({ buildId: "b" }),
        },
      ],
    }),
    updateMessage: async (...args: unknown[]) => {
      updates.push(args);
      return update();
    },
  } as unknown as QueueClient;
  const queue = createAzureStorageQueuesQueue({
    queueName: "q",
    connectionString: "UseDevelopmentStorage=true",
    client,
    visibilityTimeout: 60,
  });
  return { queue, updates };
}

function makeBus(renew: () => Promise<unknown>) {
  const message = {
    messageId: "m1",
    body: JSON.stringify({ buildId: "b" }),
    deliveryCount: 1,
    lockedUntilUtc: new Date(Date.now() + 60_000),
  };
  const receiver = {
    receiveMessages: async () => [message],
    renewMessageLock: renew,
    close: async () => {},
  } as unknown as ServiceBusReceiver;
  const queue = createAzureServiceBusQueue({
    queueName: "q",
    connectionString: "Endpoint=sb://x/;SharedAccessKeyName=k;SharedAccessKey=v",
    receiver,
    sender: { sendMessages: async () => {}, close: async () => {} } as never,
    client: { close: async () => {} } as never,
    adminClient: {} as ServiceBusAdministrationClient,
  });
  return { queue };
}

describe("storage queues extend", () => {
  it("renews visibility and swaps in the rotated pop receipt", async () => {
    const { queue, updates } = makeStorage(() => ({ popReceipt: "pr2" }));
    const job = (await queue.poll())!;
    expect(job.leaseMs).toBe(60_000);
    expect(await queue.extend!(job)).toBe("ok");
    expect(updates[0]).toEqual(["m1", "pr1", undefined, 60]);
    expect(job.receipt).toBe("m1|pr2");
  });

  it("reports 404 as lost and rethrows other errors", async () => {
    let failure: unknown = null;
    const { queue } = makeStorage(() => {
      throw failure;
    });
    const job = (await queue.poll())!;
    failure = Object.assign(new Error("gone"), { statusCode: 404 });
    expect(await queue.extend!(job)).toBe("lost");
    failure = Object.assign(new Error("busy"), { statusCode: 503 });
    await expect(queue.extend!(job)).rejects.toThrow("busy");
  });

  it("is a no-op without a usable receipt", async () => {
    const { queue, updates } = makeStorage(() => ({}));
    expect(await queue.extend!({ buildId: "b" })).toBe("ok");
    expect(await queue.extend!({ buildId: "b", receipt: "m1" })).toBe("ok");
    expect(updates).toHaveLength(0);
  });
});

describe("service bus extend", () => {
  it("derives leaseMs from the lock and renews it", async () => {
    let renewed = 0;
    const { queue } = makeBus(async () => {
      renewed += 1;
    });
    const job = (await queue.poll())!;
    expect(job.leaseMs).toBeGreaterThan(55_000);
    expect(await queue.extend!(job)).toBe("ok");
    expect(renewed).toBe(1);
  });

  it("reports MessageLockLost as lost and rethrows other errors", async () => {
    let failure: unknown = null;
    const { queue } = makeBus(async () => {
      throw failure;
    });
    const job = (await queue.poll())!;
    failure = Object.assign(new Error("lost"), { code: "MessageLockLost" });
    expect(await queue.extend!(job)).toBe("lost");
    failure = new Error("transient");
    await expect(queue.extend!(job)).rejects.toThrow("transient");
  });

  it("is a no-op without the raw message", async () => {
    const { queue } = makeBus(async () => {});
    expect(await queue.extend!({ buildId: "b" })).toBe("ok");
  });
});
