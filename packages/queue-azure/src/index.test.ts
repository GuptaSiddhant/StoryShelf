import type { QueueClient } from "@azure/storage-queue";
import { describe, expect, it } from "vitest";
import { createAzureQueue } from "./index.ts";

const STORAGE_CONNECTION =
  "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=xxx;QueueEndpoint=http://127.0.0.1:10001/devstoreaccount1;";
const SB_CONNECTION =
  "Endpoint=sb://fake.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=ZmFrZQ==";

describe("createAzureQueue dispatcher", () => {
  it("selects the storage-queues backend", async () => {
    const client = {
      sendMessage: async () => {
        await Promise.resolve();
      },
      getProperties: async () => {
        await Promise.resolve();
      },
      close: async () => {
        await Promise.resolve();
      },
      receiveMessages: async () => [],
      deleteMessage: async () => {
        await Promise.resolve();
      },
      updateMessage: async () => {
        await Promise.resolve();
      },
    } as unknown as QueueClient;
    const queue = await createAzureQueue({
      backend: "storage-queues",
      queueName: "capture-jobs",
      connectionString: STORAGE_CONNECTION,
      client,
    });
    expect(queue.metadata.kind).toBe("azure-storage-queues");
    expect(queue.metadata.category).toBe("capture-queue");
    expect(await queue.status("build-1")).toBeNull();
  });

  it("selects the service-bus backend", async () => {
    const queue = await createAzureQueue({
      backend: "service-bus",
      queueName: "capture-jobs",
      connectionString: SB_CONNECTION,
    });
    expect(queue.metadata.kind).toBe("azure-service-bus");
    expect(queue.metadata.category).toBe("capture-queue");
  });
});
