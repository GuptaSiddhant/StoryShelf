/** Enqueue and remote-queue no-op tests for the Pub/Sub queue. */
import type { v1 } from "@google-cloud/pubsub";
import { describe, expect, it } from "vitest";
import { createGcpPubSubQueue } from "./index.ts";

interface Call {
  name: string;
  args: unknown[];
}

function makeSubscriber(): { subscriber: v1.SubscriberClient } {
  const subscriber = {
    pull: async (): Promise<unknown> => await Promise.resolve([{ receivedMessages: [] }]),
    acknowledge: async (): Promise<void> => {
      await Promise.resolve();
    },
    modifyAckDeadline: async (): Promise<void> => {
      await Promise.resolve();
    },
    getSubscription: async (): Promise<void> => {
      await Promise.resolve();
    },
    close: async (): Promise<void> => {
      await Promise.resolve();
    },
  } as unknown as v1.SubscriberClient;
  return { subscriber };
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

describe("createGcpPubSubQueue - enqueue", () => {
  it("publishes a serialized job body with the buildId attribute", async () => {
    const inputs: Call[] = [];
    const { subscriber } = makeSubscriber();
    const queue = createGcpPubSubQueue({
      ...options,
      subscriber,
      publisher: makePublisher(inputs),
    });
    await queue.enqueue({ buildId: "build-1", reqId: "req-1" });
    const [request] = inputs[0]?.args ?? [];
    const typed = request as {
      topic: string;
      messages: { data: Uint8Array; attributes: Record<string, string> }[];
    };
    expect(typed.topic).toBe("projects/acme-shelf/topics/capture-jobs");
    const body = JSON.parse(new TextDecoder().decode(typed.messages[0]?.data)) as Record<
      string,
      unknown
    >;
    expect(body["buildId"]).toBe("build-1");
    expect(body["reqId"]).toBe("req-1");
    expect(body["status"]).toBe("queued");
    expect(typed.messages[0]?.attributes["buildId"]).toBe("build-1");
  });
});

describe("createGcpPubSubQueue - status/active/recent", () => {
  it("returns null/empty (DB is source of truth)", async () => {
    const { subscriber } = makeSubscriber();
    const queue = createGcpPubSubQueue({ ...options, subscriber, publisher: makePublisher([]) });
    expect(await queue.status("build-1")).toBeNull();
    expect(await queue.active()).toEqual([]);
    expect(await queue.recent(5)).toEqual([]);
  });
});
