import { createShelfLogger } from "@storyshelf/core/logger";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { describe, expect, it, vi } from "vitest";
import { setupCaptureQueue } from "./capture-setup.ts";

function makeLogger() {
  return createShelfLogger({ level: "silent" });
}

function makeQueue() {
  return {
    metadata: { name: "mock", version: "0.0.0", kind: "mock", category: "capture-queue" as const },
    enqueue: vi.fn(async () => {}),
    status: vi.fn(async () => null),
    active: vi.fn(async () => []),
    recent: vi.fn(async () => []),
  } as unknown as import("@storyshelf/core/adapter/capture-queue").CaptureQueue;
}

function makeRunner() {
  return {
    metadata: { name: "mock", version: "0.0.0", kind: "mock", category: "capture-runner" as const },
    render: vi.fn(async () => ({ captures: [], failures: [] })),
    cancel: vi.fn(async () => {}),
  } as unknown as import("@storyshelf/core/adapter/capture-runner").CaptureRunner;
}

describe("setupCaptureQueue", () => {
  it("returns null when no queue and no runner", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const result = setupCaptureQueue(
      { database: db as never, storage: storage as never },
      {},
      [],
      makeLogger(),
    );
    expect(result.queue).toBeNull();
    expect(result.enqueueCapture).toBeUndefined();
  });

  it("throws when runner provided without scratchDir", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    expect(() =>
      setupCaptureQueue(
        { database: db as never, storage: storage as never, captureRunner: makeRunner() },
        {},
        [],
        makeLogger(),
      ),
    ).toThrow("ShelfConfig.scratchDir is not set");
  });

  it("creates InMemory queue when runner and scratchDir provided", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const result = setupCaptureQueue(
      { database: db as never, storage: storage as never, captureRunner: makeRunner() },
      { scratchDir: "/tmp" },
      [],
      makeLogger(),
    );
    expect(result.queue).not.toBeNull();
    expect(result.queue?.metadata.kind).toBe("memory");
    expect(result.enqueueCapture).toBeDefined();
  });

  it("returns supplied queue when only queue provided", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const queue = makeQueue();
    const result = setupCaptureQueue(
      { database: db as never, storage: storage as never, captureQueue: queue },
      {},
      [],
      makeLogger(),
    );
    expect(result.queue).toBe(queue);
    expect(result.enqueueCapture).toBeDefined();
    await result.enqueueCapture?.("build-1", "req-1");
    expect(queue.enqueue).toHaveBeenCalledWith({ buildId: "build-1", reqId: "req-1" });
  });

  it("returns supplied queue when both queue and runner provided without scratchDir", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const queue = makeQueue();
    const result = setupCaptureQueue(
      {
        database: db as never,
        storage: storage as never,
        captureQueue: queue,
        captureRunner: makeRunner(),
      },
      {},
      [],
      makeLogger(),
    );
    expect(result.queue).toBe(queue);
  });

  it("prefers supplied queue over InMemory when both provided with scratchDir", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const queue = makeQueue();
    const result = setupCaptureQueue(
      {
        database: db as never,
        storage: storage as never,
        captureQueue: queue,
        captureRunner: makeRunner(),
      },
      { scratchDir: "/tmp" },
      [],
      makeLogger(),
    );
    expect(result.queue).toBe(queue);
    expect(result.queue?.metadata.kind).toBe("mock");
  });

  it("returns null enqueue when no queue and no runner after queue check", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    // Exercise the second no-runner guard (after queue check)
    const result = setupCaptureQueue(
      { database: db as never, storage: storage as never },
      { scratchDir: "/tmp" },
      [],
      makeLogger(),
    );
    expect(result.queue).toBeNull();
  });

  it("respects captureConcurrency config", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const result = setupCaptureQueue(
      { database: db as never, storage: storage as never, captureRunner: makeRunner() },
      { scratchDir: "/tmp", captureConcurrency: 5 },
      [],
      makeLogger(),
    );
    expect(result.queue).not.toBeNull();
  });
});
