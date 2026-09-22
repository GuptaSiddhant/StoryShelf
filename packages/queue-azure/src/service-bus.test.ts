import type {
  ServiceBusAdministrationClient,
  ServiceBusClient,
  ServiceBusReceivedMessage,
  ServiceBusReceiver,
  ServiceBusSender,
} from "@azure/service-bus";
import type { Logger } from "@storyshelf/core/logger";
import { describe, expect, it, vi } from "vitest";
import { createAzureServiceBusQueue } from "./service-bus.ts";

interface Handlers {
  receive?: () => unknown;
  runtimeProps?: () => unknown;
}

function makeReceiver(handlers: Handlers): { receiver: ServiceBusReceiver; calls: string[] } {
  const calls: string[] = [];
  const receiver = {
    receiveMessages: async () => {
      calls.push("receiveMessages");
      return handlers.receive ? handlers.receive() : [];
    },
    completeMessage: async () => {
      calls.push("completeMessage");
    },
    abandonMessage: async () => {
      calls.push("abandonMessage");
    },
    close: async () => {
      calls.push("close");
    },
    deadLetterMessage: async () => {
      calls.push("deadLetterMessage");
    },
    peekMessage: async () => {
      await Promise.resolve();
    },
  } as unknown as ServiceBusReceiver;
  return { receiver, calls };
}

function makeSender(calls: string[]): ServiceBusSender {
  return {
    sendMessages: async () => {
      calls.push("sendMessages");
    },
    close: async () => {
      calls.push("senderClose");
    },
  } as unknown as ServiceBusSender;
}

const options = {
  queueName: "capture-jobs",
  connectionString:
    "Endpoint=sb://fake.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=ZmFrZQ==",
};

describe("metadata and lifecycle", () => {
  it("has correct metadata", () => {
    const { receiver } = makeReceiver({});
    const sender = makeSender([]);
    const queue = createAzureServiceBusQueue({ ...options, sender, receiver });
    expect(queue.metadata.name).toBe("Azure Service Bus Queue");
    expect(queue.metadata.kind).toBe("azure-service-bus");
    expect(queue.metadata.category).toBe("capture-queue");
    expect(queue.metadata.version).toBe("0.0.0");
  });

  it("setup probes the queue runtime properties", async () => {
    const adminClient = { getQueueRuntimeProperties: vi.fn().mockResolvedValue({}) };
    const { receiver } = makeReceiver({});
    const sender = makeSender([]);
    const queue = createAzureServiceBusQueue({
      ...options,
      sender,
      receiver,
      adminClient: adminClient as unknown as ServiceBusAdministrationClient,
    });
    await queue.lifecycle?.setup({} as never);
    expect(adminClient.getQueueRuntimeProperties).toHaveBeenCalledWith("capture-jobs");
  });

  it("health probes and reports ok", async () => {
    const adminClient = { getQueueRuntimeProperties: vi.fn().mockResolvedValue({}) };
    const { receiver } = makeReceiver({});
    const sender = makeSender([]);
    const queue = createAzureServiceBusQueue({
      ...options,
      sender,
      receiver,
      adminClient: adminClient as unknown as ServiceBusAdministrationClient,
    });
    expect(await queue.lifecycle?.health()).toEqual({ ok: true });
  });

  it("teardown closes injected receiver and sender but not client", async () => {
    const { receiver, calls } = makeReceiver({});
    const sender = makeSender(calls);
    const client = { close: vi.fn() } as unknown as ServiceBusClient;
    const queue = createAzureServiceBusQueue({ ...options, client, sender, receiver });
    await queue.lifecycle?.teardown();
    expect(calls).toContain("close");
    expect(calls).toContain("senderClose");
    expect(client.close).not.toHaveBeenCalled();
  });
});

describe("enqueue", () => {
  it("sends a serialized body with application properties", async () => {
    const sender = {
      sendMessages: vi.fn(),
      close: async () => {},
    } as unknown as ServiceBusSender;
    const { receiver } = makeReceiver({});
    const queue = createAzureServiceBusQueue({ ...options, sender, receiver });
    await queue.enqueue({ buildId: "build-1", reqId: "req-1" });
    expect(sender.sendMessages).toHaveBeenCalledOnce();
    const message = vi.mocked(sender.sendMessages).mock.calls[0]?.[0] as {
      messageId: string;
      body: string;
      applicationProperties: Record<string, string>;
    };
    expect(message.messageId).toBe("build-1");
    expect(JSON.parse(message.body) as Record<string, unknown>).toMatchObject({
      buildId: "build-1",
    });
  });
});

describe("status/active/recent", () => {
  it("returns null/empty (DB is source of truth)", async () => {
    const { receiver } = makeReceiver({});
    const sender = makeSender([]);
    const queue = createAzureServiceBusQueue({ ...options, sender, receiver });
    expect(await queue.status("build-1")).toBeNull();
    expect(await queue.active()).toEqual([]);
    expect(await queue.recent(5)).toEqual([]);
  });
});

const RECEIVED = (overrides: Partial<ServiceBusReceivedMessage> = {}): ServiceBusReceivedMessage =>
  ({
    messageId: "message-1",
    body: JSON.stringify({ buildId: "build-1", reqId: "req-1" }),
    deliveryCount: 1,
    ...overrides,
  }) as unknown as ServiceBusReceivedMessage;

describe("poll", () => {
  it("returns null when no messages", async () => {
    const { receiver } = makeReceiver({ receive: () => [] });
    const sender = makeSender([]);
    const queue = createAzureServiceBusQueue({ ...options, sender, receiver });
    expect(await queue.poll({ waitMs: 100 })).toBeNull();
  });

  it("returns null when the message has no body", async () => {
    const { receiver } = makeReceiver({ receive: () => [RECEIVED({ body: undefined })] });
    const sender = makeSender([]);
    const queue = createAzureServiceBusQueue({ ...options, sender, receiver });
    expect(await queue.poll()).toBeNull();
  });

  it("completes malformed messages and warns", async () => {
    const logger = { warn: vi.fn() };
    const { receiver, calls } = makeReceiver({
      receive: () => [RECEIVED({ body: "not-json", messageId: "m-bad" })],
    });
    const sender = makeSender([]);
    const queue = createAzureServiceBusQueue({
      ...options,
      sender,
      receiver,
      logger: logger as unknown as Logger,
    });
    expect(await queue.poll()).toBeNull();
    expect(calls).toContain("completeMessage");
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("returns a job with attempts derived from deliveryCount", async () => {
    const { receiver } = makeReceiver({
      receive: () => [RECEIVED({ deliveryCount: 3 })],
    });
    const sender = makeSender([]);
    const queue = createAzureServiceBusQueue({ ...options, sender, receiver });
    const job = await queue.poll();
    expect(job?.buildId).toBe("build-1");
    expect(job?.reqId).toBe("req-1");
    expect(job?.attempts).toBe(2);
    expect(job?.receipt).toBe("message-1");
    expect(job?.raw).toBeDefined();
  });
});

describe("ack/nack", () => {
  it("acks by completing the raw message", async () => {
    const { receiver, calls } = makeReceiver({});
    const sender = makeSender([]);
    const queue = createAzureServiceBusQueue({ ...options, sender, receiver });
    const raw = {
      messageId: "message-1",
      body: JSON.stringify({ buildId: "build-1" }),
    } as unknown as ServiceBusReceivedMessage;
    await queue.ack({ buildId: "build-1", receipt: "message-1", raw });
    expect(calls).toContain("completeMessage");
  });

  it("ack without raw message is a no-op", async () => {
    const { receiver, calls } = makeReceiver({});
    const sender = makeSender([]);
    const queue = createAzureServiceBusQueue({ ...options, sender, receiver });
    await queue.ack({ buildId: "build-1", receipt: "message-1" });
    expect(calls).not.toContain("completeMessage");
  });

  it("nack with requeue false completes (discards) the message", async () => {
    const { receiver, calls } = makeReceiver({});
    const sender = makeSender([]);
    const queue = createAzureServiceBusQueue({ ...options, sender, receiver });
    const raw = {
      messageId: "message-1",
      body: JSON.stringify({ buildId: "build-1" }),
    } as unknown as ServiceBusReceivedMessage;
    await queue.nack({ buildId: "build-1", raw }, { requeue: false });
    expect(calls).toContain("completeMessage");
  });

  it("nack abandons for immediate redelivery by default", async () => {
    const { receiver, calls } = makeReceiver({});
    const sender = makeSender([]);
    const queue = createAzureServiceBusQueue({ ...options, sender, receiver });
    const raw = {
      messageId: "message-1",
      body: JSON.stringify({ buildId: "build-1" }),
    } as unknown as ServiceBusReceivedMessage;
    await queue.nack({ buildId: "build-1", raw }, { delayMs: 5000 });
    expect(calls).toContain("abandonMessage");
    expect(calls).not.toContain("completeMessage");
  });
});
