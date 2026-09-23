import type { v1 } from "@google-cloud/pubsub";
import type { Logger } from "@storyshelf/core/logger";
import { describe, expect, it, vi } from "vitest";
import { createGcpPubSubQueue } from "./index.ts";

interface Call {
  name: string;
  args: unknown[];
}

interface SubscriberHandlers {
  messages?: () => unknown[];
}

function makeSubscriber(handlers: SubscriberHandlers = {}): {
  subscriber: v1.SubscriberClient;
  calls: string[];
  inputs: Call[];
} {
  const calls: string[] = [];
  const inputs: Call[] = [];
  const record = (name: string, args: unknown[]): void => {
    calls.push(name);
    inputs.push({ name, args });
  };
  const subscriber = {
    pull: async (...args: unknown[]) => {
      record("pull", args);
      return [{ receivedMessages: handlers.messages ? handlers.messages() : [] }];
    },
    acknowledge: async (...args: unknown[]) => record("acknowledge", args),
    modifyAckDeadline: async (...args: unknown[]) => record("modifyAckDeadline", args),
    getSubscription: async (...args: unknown[]) => record("getSubscription", args),
    close: async (...args: unknown[]) => record("close", args),
  } as unknown as v1.SubscriberClient;
  return { subscriber, calls, inputs };
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

const RECEIVED = (overrides: Record<string, unknown> = {}): unknown => ({
  ackId: "ack-1",
  deliveryAttempt: 1,
  message: {
    data: new TextEncoder().encode(JSON.stringify({ buildId: "build-1", reqId: "req-1" })),
    attributes: { buildId: "build-1" },
    messageId: "m-1",
  },
  ...overrides,
});

describe("metadata and lifecycle", () => {
  it("has correct metadata", () => {
    const { subscriber } = makeSubscriber();
    const queue = createGcpPubSubQueue({ ...options, subscriber, publisher: makePublisher([]) });
    expect(queue.metadata.name).toBe("GCP Pub/Sub Queue");
    expect(queue.metadata.kind).toBe("gcp-pubsub");
    expect(queue.metadata.category).toBe("capture-queue");
    expect(queue.metadata.version).toBe("0.0.0");
  });

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

describe("enqueue", () => {
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

describe("status/active/recent", () => {
  it("returns null/empty (DB is source of truth)", async () => {
    const { subscriber } = makeSubscriber();
    const queue = createGcpPubSubQueue({ ...options, subscriber, publisher: makePublisher([]) });
    expect(await queue.status("build-1")).toBeNull();
    expect(await queue.active()).toEqual([]);
    expect(await queue.recent(5)).toEqual([]);
  });
});

describe("poll", () => {
  it("returns null when no messages", async () => {
    const { subscriber } = makeSubscriber({ messages: () => [] });
    const queue = createGcpPubSubQueue({ ...options, subscriber, publisher: makePublisher([]) });
    expect(await queue.poll()).toBeNull();
  });

  it("returns null and leaves empty-data messages for redelivery", async () => {
    const { subscriber, calls } = makeSubscriber({
      messages: () => [RECEIVED({ message: { data: new Uint8Array(0) } })],
    });
    const queue = createGcpPubSubQueue({ ...options, subscriber, publisher: makePublisher([]) });
    expect(await queue.poll()).toBeNull();
    expect(calls).not.toContain("acknowledge");
  });

  it("acknowledges malformed messages and warns", async () => {
    const logger = { warn: vi.fn() };
    const { subscriber, calls } = makeSubscriber({
      messages: () => [
        RECEIVED({
          ackId: "ack-bad",
          message: { data: new TextEncoder().encode("not-json") },
        }),
      ],
    });
    const queue = createGcpPubSubQueue({
      ...options,
      subscriber,
      publisher: makePublisher([]),
      logger: logger as unknown as Logger,
    });
    expect(await queue.poll()).toBeNull();
    expect(calls).toContain("acknowledge");
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  describe("host logger binding", () => {
    const malformed = () => [
      RECEIVED({
        ackId: "ack-bad",
        message: { data: new TextEncoder().encode("not-json") },
      }),
    ];

    it("warns through the bound host logger", async () => {
      const { subscriber } = makeSubscriber({ messages: malformed });
      const queue = createGcpPubSubQueue({ ...options, subscriber, publisher: makePublisher([]) });
      const warn = vi.fn();
      queue.setLogger?.({ warn } as unknown as Logger);
      expect(await queue.poll()).toBeNull();
      expect(warn).toHaveBeenCalledOnce();
    });

    it("prefers the explicit options logger over the bound one", async () => {
      const { subscriber } = makeSubscriber({ messages: malformed });
      const explicit = vi.fn();
      const bound = vi.fn();
      const queue = createGcpPubSubQueue({
        ...options,
        subscriber,
        publisher: makePublisher([]),
        logger: { warn: explicit } as unknown as Logger,
      });
      queue.setLogger?.({ warn: bound } as unknown as Logger);
      expect(await queue.poll()).toBeNull();
      expect(explicit).toHaveBeenCalledOnce();
      expect(bound).not.toHaveBeenCalled();
    });
  });

  it("acknowledges null-body messages and warns", async () => {
    const logger = { warn: vi.fn() };
    const { subscriber, calls } = makeSubscriber({
      messages: () => [
        RECEIVED({ ackId: "ack-null", message: { data: new TextEncoder().encode("null") } }),
      ],
    });
    const queue = createGcpPubSubQueue({
      ...options,
      subscriber,
      publisher: makePublisher([]),
      logger: logger as unknown as Logger,
    });
    expect(await queue.poll()).toBeNull();
    expect(calls).toContain("acknowledge");
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("returns a job with attempts derived from deliveryAttempt", async () => {
    const { subscriber, inputs } = makeSubscriber({
      messages: () => [RECEIVED({ ackId: "ack-3", deliveryAttempt: 3 })],
    });
    const queue = createGcpPubSubQueue({ ...options, subscriber, publisher: makePublisher([]) });
    const job = await queue.poll();
    expect(job?.buildId).toBe("build-1");
    expect(job?.reqId).toBe("req-1");
    expect(job?.attempts).toBe(2);
    expect(job?.receipt).toBe("ack-3");
    expect(job?.raw).toBeDefined();
    expect(inputs[0]?.args[0]).toMatchObject({
      subscription: "projects/acme-shelf/subscriptions/capture-jobs-worker",
      maxMessages: 1,
    });
  });
});

describe("ack/nack", () => {
  it("acks by acknowledging the receipted message", async () => {
    const { subscriber, inputs, calls } = makeSubscriber();
    const queue = createGcpPubSubQueue({ ...options, subscriber, publisher: makePublisher([]) });
    await queue.ack({ buildId: "build-1", receipt: "ack-1" });
    expect(calls).toContain("acknowledge");
    expect(inputs[0]?.args[0]).toMatchObject({ ackIds: ["ack-1"] });
  });

  it("ack without receipt is a no-op", async () => {
    const { subscriber, calls } = makeSubscriber();
    const queue = createGcpPubSubQueue({ ...options, subscriber, publisher: makePublisher([]) });
    await queue.ack({ buildId: "build-1" });
    expect(calls).not.toContain("acknowledge");
  });

  it("nack with requeue false acknowledges (drops) the message", async () => {
    const { subscriber, calls } = makeSubscriber();
    const queue = createGcpPubSubQueue({ ...options, subscriber, publisher: makePublisher([]) });
    await queue.nack({ buildId: "build-1", receipt: "ack-1" }, { requeue: false });
    expect(calls).toContain("acknowledge");
    expect(calls).not.toContain("modifyAckDeadline");
  });

  it("nack redelivers immediately by default", async () => {
    const { subscriber, inputs, calls } = makeSubscriber();
    const queue = createGcpPubSubQueue({ ...options, subscriber, publisher: makePublisher([]) });
    await queue.nack({ buildId: "build-1", receipt: "ack-1" });
    expect(calls).toContain("modifyAckDeadline");
    expect(inputs[0]?.args[0]).toMatchObject({ ackIds: ["ack-1"], ackDeadlineSeconds: 0 });
  });

  it("nack honors delayMs via modifyAckDeadline", async () => {
    const { subscriber, inputs } = makeSubscriber();
    const queue = createGcpPubSubQueue({ ...options, subscriber, publisher: makePublisher([]) });
    await queue.nack({ buildId: "build-1", receipt: "ack-1" }, { delayMs: 5000 });
    expect(inputs[0]?.args[0]).toMatchObject({ ackIds: ["ack-1"], ackDeadlineSeconds: 5 });
  });
});
