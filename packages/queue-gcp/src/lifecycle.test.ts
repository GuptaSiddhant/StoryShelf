/** Lifecycle setup/health/teardown tests for the Pub/Sub queue. */
import type { v1 } from "@google-cloud/pubsub";
import { describe, expect, it } from "vitest";
import { createGcpPubSubQueue } from "./index.ts";

interface Call {
  name: string;
  args: unknown[];
}

function makeSubscriber(): { subscriber: v1.SubscriberClient; calls: string[] } {
  const calls: string[] = [];
  const subscriber = {
    getSubscription: async (...args: unknown[]): Promise<void> => {
      calls.push("getSubscription");
      await Promise.resolve(args);
    },
    close: async (...args: unknown[]): Promise<void> => {
      calls.push("close");
      await Promise.resolve(args);
    },
  } as unknown as v1.SubscriberClient;
  return { subscriber, calls };
}

function makePublisher(inputs: Call[]): v1.PublisherClient {
  return {
    publish: async (...args: unknown[]) => {
      inputs.push({ name: "publish", args });
      return [{ messageIds: ["m-1"] }];
    },
    getTopic: async (...args: unknown[]) => {
      inputs.push({ name: "getTopic", args });
      await Promise.resolve();
    },
    close: async () => {
      await Promise.resolve();
    },
  } as unknown as v1.PublisherClient;
}

const options = {
  topic: "capture-jobs",
  subscription: "capture-jobs-worker",
  projectId: "acme-shelf",
};

describe("createGcpPubSubQueue - lifecycle", () => {
  it("setup verifies the topic", async () => {
    const inputs: Call[] = [];
    const { subscriber } = makeSubscriber();
    const queue = createGcpPubSubQueue({
      ...options,
      subscriber,
      publisher: makePublisher(inputs),
    });
    await queue.lifecycle?.setup({} as never);
    const [request] = inputs;
    expect(request?.args[0]).toMatchObject({
      topic: "projects/acme-shelf/topics/capture-jobs",
    });
  });

  it("health verifies the subscription and reports ok", async () => {
    const { subscriber, calls } = makeSubscriber();
    const queue = createGcpPubSubQueue({ ...options, subscriber, publisher: makePublisher([]) });
    const health = await queue.lifecycle?.health();
    expect(health).toEqual({ ok: true });
    expect(calls).toContain("getSubscription");
  });

  it("teardown closes owned clients and is idempotent", async () => {
    const inputs: Call[] = [];
    const queue = createGcpPubSubQueue({ ...options, publisher: makePublisher(inputs) });
    await queue.lifecycle?.teardown();
    await queue.lifecycle?.teardown();
    expect(inputs).toEqual([]);
  });

  it("teardown never closes injected clients", async () => {
    const inputs: Call[] = [];
    const { subscriber, calls } = makeSubscriber();
    const queue = createGcpPubSubQueue({
      ...options,
      subscriber,
      publisher: makePublisher(inputs),
    });
    await queue.lifecycle?.teardown();
    expect(calls).not.toContain("close");
    expect(inputs).toEqual([]);
  });
});
