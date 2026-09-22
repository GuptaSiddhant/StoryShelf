import type { DequeuedMessageItem, QueueClient } from "@azure/storage-queue";
import type { Logger } from "@storyshelf/core/logger";
import { describe, expect, it, vi } from "vitest";
import { createAzureStorageQueuesQueue } from "./storage-queues.ts";

interface Call {
  name: string;
  args: unknown[];
}

interface Handlers {
  receive?: () => unknown;
}

function makeClient(handlers: Handlers = {}): {
  client: QueueClient;
  calls: string[];
  inputs: Call[];
} {
  const calls: string[] = [];
  const inputs: Call[] = [];
  const record = (name: string, args: unknown[]): void => {
    calls.push(name);
    inputs.push({ name, args });
  };
  const client = {
    sendMessage: async (...args: unknown[]) => record("sendMessage", args),
    getProperties: async (...args: unknown[]) => record("getProperties", args),
    receiveMessages: async (...args: unknown[]) => {
      record("receiveMessages", args);
      const received = handlers.receive ? (handlers.receive() as DequeuedMessageItem[]) : [];
      return { receivedMessageItems: received };
    },
    deleteMessage: async (...args: unknown[]) => record("deleteMessage", args),
    updateMessage: async (...args: unknown[]) => record("updateMessage", args),
  } as unknown as QueueClient;
  return {
    client,
    calls,
    inputs,
  };
}

const options = {
  queueName: "capture-jobs",
  connectionString:
    "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=xxx;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;QueueEndpoint=http://127.0.0.1:10001/devstoreaccount1;",
};

const DEQUEUED = (overrides: Partial<DequeuedMessageItem> = {}): DequeuedMessageItem =>
  ({
    messageId: "m-1",
    messageText: JSON.stringify({ buildId: "build-1", reqId: "req-1" }),
    popReceipt: "pr-1",
    dequeueCount: 1,
    insertionTime: new Date(),
    expirationTime: new Date(),
    ...overrides,
  }) as unknown as DequeuedMessageItem;

describe("metadata and lifecycle", () => {
  it("has correct metadata", () => {
    const { client } = makeClient();
    const queue = createAzureStorageQueuesQueue({ ...options, client });
    expect(queue.metadata.name).toBe("Azure Storage Queues Queue");
    expect(queue.metadata.kind).toBe("azure-storage-queues");
    expect(queue.metadata.category).toBe("capture-queue");
    expect(queue.metadata.version).toBe("0.0.0");
  });

  it("setup probes the queue", async () => {
    const { client, calls } = makeClient();
    const queue = createAzureStorageQueuesQueue({ ...options, client });
    await queue.lifecycle?.setup({} as never);
    expect(calls).toContain("getProperties");
  });

  it("health probes the queue and reports ok", async () => {
    const { client, calls } = makeClient();
    const queue = createAzureStorageQueuesQueue({ ...options, client });
    const health = await queue.lifecycle?.health();
    expect(health).toEqual({ ok: true });
    expect(calls).toContain("getProperties");
  });

  it("teardown is a no-op and idempotent for storage queues", async () => {
    const { client, calls } = makeClient();
    const queue = createAzureStorageQueuesQueue({ ...options, client });
    await queue.lifecycle?.teardown();
    await queue.lifecycle?.teardown();
    expect(calls).toEqual([]);
  });
});

describe("enqueue", () => {
  it("sends a serialized job body", async () => {
    const { client, inputs } = makeClient();
    const queue = createAzureStorageQueuesQueue({ ...options, client });
    await queue.enqueue({ buildId: "build-1", reqId: "req-1" });
    const [text] = inputs[0]?.args ?? [];
    const body = JSON.parse(String(text)) as Record<string, unknown>;
    expect(body["buildId"]).toBe("build-1");
    expect(body["reqId"]).toBe("req-1");
    expect(body["status"]).toBe("queued");
  });
});

describe("status/active/recent", () => {
  it("returns null/empty (DB is source of truth)", async () => {
    const { client } = makeClient();
    const queue = createAzureStorageQueuesQueue({ ...options, client });
    expect(await queue.status("build-1")).toBeNull();
    expect(await queue.active()).toEqual([]);
    expect(await queue.recent(5)).toEqual([]);
  });
});

describe("poll", () => {
  it("returns null when no messages", async () => {
    const { client } = makeClient({ receive: () => [] });
    const queue = createAzureStorageQueuesQueue({ ...options, client });
    expect(await queue.poll()).toBeNull();
  });

  it("returns null when the message has no text", async () => {
    const { client } = makeClient({ receive: () => [DEQUEUED({ messageText: "" })] });
    const queue = createAzureStorageQueuesQueue({ ...options, client });
    expect(await queue.poll()).toBeNull();
  });

  it("deletes malformed messages and warns", async () => {
    const logger = { warn: vi.fn() };
    const { client, calls } = makeClient({
      receive: () => [
        DEQUEUED({ messageText: "not-json", messageId: "m-bad", popReceipt: "pr-bad" }),
      ],
    });
    const queue = createAzureStorageQueuesQueue({
      ...options,
      client,
      logger: logger as unknown as Logger,
    });
    expect(await queue.poll()).toBeNull();
    expect(calls).toContain("deleteMessage");
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("deletes null-body messages and warns", async () => {
    const logger = { warn: vi.fn() };
    const { client, calls } = makeClient({
      receive: () => [
        DEQUEUED({ messageText: "null", messageId: "m-null", popReceipt: "pr-null" }),
      ],
    });
    const queue = createAzureStorageQueuesQueue({
      ...options,
      client,
      logger: logger as unknown as Logger,
    });
    expect(await queue.poll()).toBeNull();
    expect(calls).toContain("deleteMessage");
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("returns null when the poll is aborted", async () => {
    const client = {
      receiveMessages: async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      },
    } as unknown as QueueClient;
    const queue = createAzureStorageQueuesQueue({ ...options, client, waitMs: 50 });
    expect(await queue.poll()).toBeNull();
  });

  it("rethows non-abort receive failures", async () => {
    const client = {
      receiveMessages: async () => {
        throw new Error("boom");
      },
    } as unknown as QueueClient;
    const queue = createAzureStorageQueuesQueue({ ...options, client, waitMs: 50 });
    await expect(queue.poll()).rejects.toThrow("boom");
  });

  it("returns a job with attempts derived from dequeueCount", async () => {
    const { client } = makeClient({ receive: () => [DEQUEUED({ dequeueCount: 3 })] });
    const queue = createAzureStorageQueuesQueue({ ...options, client });
    const job = await queue.poll();
    expect(job?.buildId).toBe("build-1");
    expect(job?.reqId).toBe("req-1");
    expect(job?.attempts).toBe(2);
    expect(job?.receipt).toBe("m-1|pr-1");
    expect(job?.raw).toBeDefined();
  });
});

describe("ack/nack", () => {
  it("acks by deleting the receipted message", async () => {
    const { client, inputs, calls } = makeClient();
    const queue = createAzureStorageQueuesQueue({ ...options, client });
    await queue.ack({ buildId: "build-1", receipt: "m-1|pr-1" });
    expect(calls).toContain("deleteMessage");
    expect(inputs[0]?.args).toEqual(["m-1", "pr-1"]);
  });

  it("ack without receipt is a no-op", async () => {
    const { client, calls } = makeClient();
    const queue = createAzureStorageQueuesQueue({ ...options, client });
    await queue.ack({ buildId: "build-1" });
    expect(calls).not.toContain("deleteMessage");
  });

  it("nack with requeue false deletes the message", async () => {
    const { client, calls } = makeClient();
    const queue = createAzureStorageQueuesQueue({ ...options, client });
    await queue.nack({ buildId: "build-1", receipt: "m-1|pr-1" }, { requeue: false });
    expect(calls).toContain("deleteMessage");
  });

  it("nack requeues immediately by default", async () => {
    const { client, inputs, calls } = makeClient();
    const queue = createAzureStorageQueuesQueue({ ...options, client });
    await queue.nack({ buildId: "build-1", receipt: "m-1|pr-1" });
    expect(calls).toContain("updateMessage");
    expect(inputs[0]?.args?.[3]).toBe(0);
  });

  it("nack honors delayMs in seconds", async () => {
    const { client, inputs } = makeClient();
    const queue = createAzureStorageQueuesQueue({ ...options, client });
    await queue.nack(
      { buildId: "build-1", receipt: "m-1|pr-1", raw: DEQUEUED() },
      { delayMs: 2500 },
    );
    expect(inputs[0]?.args?.[3]).toBe(2);
  });
});
