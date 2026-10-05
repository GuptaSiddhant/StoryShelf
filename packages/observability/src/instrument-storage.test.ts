import { SpanStatusCode } from "@opentelemetry/api";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import type { Logger } from "@storyshelf/core/logger";
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInstrumentedStorage } from "./instrument-storage.ts";
import { installTestTelemetry, type TestTelemetry } from "./test-setup.ts";

function createFakeStorage(): StorageAdapter & { setLoggerMock: (logger: Logger) => void } {
  const files = new Map<string, Buffer>();
  const setLoggerMock = vi.fn((_logger: Logger) => {});
  return {
    metadata: {
      name: "Fake Storage",
      version: "0.0.0",
      kind: "fake",
      category: "storage",
    },
    setLoggerMock,
    setLogger: setLoggerMock,
    read: async (path: string) => {
      const data = files.get(path);
      if (!data) {
        throw new Error(`missing: ${path}`);
      }
      return data;
    },
    write: async (path: string, data: Buffer) => {
      files.set(path, data);
    },
    delete: async (path: string) => {
      files.delete(path);
    },
    exists: async (path: string) => files.has(path),
    list: async (prefix: string) =>
      [...files.keys()].filter((key) => key.startsWith(prefix)).toSorted(),
    writeStream: async (path: string, stream: Readable) => {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
      files.set(path, Buffer.concat(chunks));
    },
    readStream: async (path: string) => {
      const data = files.get(path);
      if (!data) {
        throw new Error(`missing: ${path}`);
      }
      return Readable.from([data]);
    },
  };
}

describe("createInstrumentedStorage", () => {
  let telemetry: TestTelemetry | undefined;

  afterEach(async () => {
    await telemetry?.cleanup();
    telemetry = undefined;
  });

  it("passes calls through with path spans", async () => {
    telemetry = installTestTelemetry();
    const storage = createInstrumentedStorage(createFakeStorage());
    await storage.write("builds/b1/a.png", Buffer.from("png"));
    expect(await storage.exists("builds/b1/a.png")).toBe(true);
    expect(await storage.list("builds/")).toEqual(["builds/b1/a.png"]);
    const spans = telemetry.exporter.getFinishedSpans();
    expect(spans.map((span) => span.name)).toEqual([
      "storage.write",
      "storage.exists",
      "storage.list",
    ]);
    expect(spans[0]?.attributes["storage.path"]).toBe("builds/b1/a.png");
  });

  it("marks failing operations ERROR and rethrows", async () => {
    telemetry = installTestTelemetry();
    const storage = createInstrumentedStorage(createFakeStorage());
    await expect(storage.read("missing.png")).rejects.toThrow("missing: missing.png");
    const spans = telemetry.exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.status.code).toBe(SpanStatusCode.ERROR);
  });

  it("delegates identity and logger binding", () => {
    const fake = createFakeStorage();
    const storage = createInstrumentedStorage(fake);
    expect(storage.metadata).toBe(fake.metadata);
    expect(storage.lifecycle).toBe(fake.lifecycle);
    const logger = { child: () => logger } as unknown as Logger;
    storage.setLogger?.(logger);
    expect(fake.setLoggerMock).toHaveBeenCalledWith(logger);
  });
});
