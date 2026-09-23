/** Client construction and ownership tests for the Pub/Sub queue. */
import type { v1 } from "@google-cloud/pubsub";
import { describe, expect, it } from "vitest";
import { createPubSubState } from "./client.ts";
import { createGcpPubSubQueue } from "./index.ts";

interface Call {
  name: string;
  args: unknown[];
}

function makeSubscriber(): { subscriber: v1.SubscriberClient; calls: string[] } {
  const calls: string[] = [];
  const subscriber = {
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

describe("createGcpPubSubQueue - metadata", () => {
  it("has correct metadata", () => {
    const { subscriber } = makeSubscriber();
    const queue = createGcpPubSubQueue({ ...options, subscriber, publisher: makePublisher([]) });
    expect(queue.metadata.name).toBe("GCP Pub/Sub Queue");
    expect(queue.metadata.kind).toBe("gcp-pubsub");
    expect(queue.metadata.category).toBe("capture-queue");
    expect(queue.metadata.version).toBe("0.0.0");
  });
});

describe("createPubSubState", () => {
  it("marks injected clients as not owned and threads topic state", () => {
    const { subscriber } = makeSubscriber();
    const publisher = makePublisher([]);

    const state = createPubSubState({ ...options, subscriber, publisher });

    expect(state.projectId).toBe("acme-shelf");
    expect(state.topic).toBe("capture-jobs");
    expect(state.subscription).toBe("capture-jobs-worker");
    expect(state.publisher).toBe(publisher);
    expect(state.subscriber).toBe(subscriber);
    expect(state.ownsPublisher).toBe(false);
    expect(state.ownsSubscriber).toBe(false);
    expect(state.destroyed).toBe(false);
  });

  it("owns clients it constructs", () => {
    const state = createPubSubState({ ...options });

    expect(state.ownsPublisher).toBe(true);
    expect(state.ownsSubscriber).toBe(true);
  });
});
