import type { PollableJob } from "@storyshelf/core/adapter/capture-queue";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_WORKER_CONFIG, resolveWorkerConfig } from "./config.ts";
import { createCaptureWorker } from "./index.ts";

function createMockQueue(jobs: PollableJob[]) {
  const ack = vi.fn(async () => {});
  const nack = vi.fn(async () => {});
  let index = 0;
  const poll = vi.fn(async () => {
    if (index >= jobs.length) {
      return null;
    }
    const job = jobs[index]!;
    index += 1;
    return job;
  });
  const enqueue = vi.fn(async () => {});
  return {
    metadata: { name: "mock", version: "0.0.0", kind: "mock", category: "capture-queue" as const },
    enqueue,
    status: vi.fn(async () => null),
    active: vi.fn(async () => []),
    recent: vi.fn(async () => []),
    poll,
    ack,
    nack,
  };
}

function createFakeAdapters() {
  const db = {
    insert: vi.fn(),
    get: vi.fn(async () => null),
    list: vi.fn(async () => []),
    update: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    count: vi.fn(async () => 0),
    all: vi.fn(async () => []),
  } as unknown as import("@storyshelf/core/adapter/database").DatabaseAdapter;
  const storage = {
    read: vi.fn(),
    write: vi.fn(),
    delete: vi.fn(),
    exists: vi.fn(async () => false),
    list: vi.fn(async () => []),
    writeStream: vi.fn(),
    readStream: vi.fn(),
  } as unknown as import("@storyshelf/core/adapter/storage").StorageAdapter;
  const runner = {
    metadata: {
      name: "mock-runner",
      version: "0.0.0",
      kind: "mock",
      category: "capture-runner" as const,
    },
    render: vi.fn(async () => ({ captures: [], failures: [] })),
    cancel: vi.fn(async () => {}),
  } as unknown as import("@storyshelf/core/adapter/capture-runner").CaptureRunner;
  return { db, storage, runner };
}

describe("resolveWorkerConfig", () => {
  it("returns defaults when no input", () => {
    expect(resolveWorkerConfig()).toEqual(DEFAULT_WORKER_CONFIG);
    expect(resolveWorkerConfig({})).toEqual(DEFAULT_WORKER_CONFIG);
  });

  it("merges overrides", () => {
    const cfg = resolveWorkerConfig({ concurrency: 5, maxRetries: 1, visibilityTimeout: 600 });
    expect(cfg.concurrency).toBe(5);
    expect(cfg.maxRetries).toBe(1);
    expect(cfg.visibilityTimeout).toBe(600);
    expect(cfg.waitTimeSeconds).toBe(DEFAULT_WORKER_CONFIG.waitTimeSeconds);
  });
});

describe("createCaptureWorker", () => {
  it("exposes default config", () => {
    expect(DEFAULT_WORKER_CONFIG.concurrency).toBe(2);
    expect(DEFAULT_WORKER_CONFIG.maxRetries).toBe(2);
  });

  it("processes a job and acks on permanent failure when maxRetries 0", async () => {
    const job: PollableJob = { buildId: "build-1", reqId: "req-1", attempts: 0, receipt: "r1" };
    const queue = createMockQueue([job]);
    const { db, storage, runner } = createFakeAdapters();

    const worker = createCaptureWorker({
      queue: queue as unknown as import("@storyshelf/core/adapter/capture-queue").CaptureQueue,
      db,
      storage,
      runner,
      scratchDir: "/tmp",
      config: { maxRetries: 0, waitTimeSeconds: 0, concurrency: 1 },
    });

    const startPromise = worker.start();
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 200);
    });
    await worker.stop();
    await startPromise.catch(() => {});

    expect(queue.ack).toHaveBeenCalled();
  });

  it("nacks with requeue when attempts < maxRetries", async () => {
    const job: PollableJob = { buildId: "build-1", attempts: 0, receipt: "r1" };
    const queue = createMockQueue([job]);
    const { db, storage, runner } = createFakeAdapters();

    const worker = createCaptureWorker({
      queue: queue as unknown as import("@storyshelf/core/adapter/capture-queue").CaptureQueue,
      db,
      storage,
      runner,
      scratchDir: "/tmp",
      config: { maxRetries: 2, waitTimeSeconds: 0, concurrency: 1 },
    });

    const startPromise = worker.start();
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 200);
    });
    await worker.stop();
    await startPromise.catch(() => {});

    expect(queue.nack).toHaveBeenCalledWith(
      expect.objectContaining({ buildId: "build-1" }),
      expect.objectContaining({ requeue: true }),
    );
  });

  it("handles poll throwing and continues", async () => {
    const poll = vi.fn(async () => {
      throw new Error("poll failed");
    });
    const ack = vi.fn(async () => {});
    const nack = vi.fn(async () => {});
    const queue = {
      metadata: {
        name: "mock",
        version: "0.0.0",
        kind: "mock",
        category: "capture-queue" as const,
      },
      enqueue: vi.fn(async () => {}),
      status: vi.fn(async () => null),
      active: vi.fn(async () => []),
      recent: vi.fn(async () => []),
      poll,
      ack,
      nack,
    };
    const { db, storage, runner } = createFakeAdapters();
    const worker = createCaptureWorker({
      queue: queue as unknown as import("@storyshelf/core/adapter/capture-queue").CaptureQueue,
      db,
      storage,
      runner,
      scratchDir: "/tmp",
      config: { waitTimeSeconds: 0, concurrency: 1 },
    });
    const startPromise = worker.start();
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 400);
    });
    await worker.stop();
    await startPromise.catch(() => {});
    expect(poll).toHaveBeenCalled();
  });

  it("handles ack failure by trying nack", async () => {
    const job: PollableJob = { buildId: "build-1", attempts: 2, receipt: "r1" };
    const queue = createMockQueue([job]);
    queue.ack.mockRejectedValueOnce(new Error("ack failed"));
    const { db, storage, runner } = createFakeAdapters();
    const worker = createCaptureWorker({
      queue: queue as unknown as import("@storyshelf/core/adapter/capture-queue").CaptureQueue,
      db,
      storage,
      runner,
      scratchDir: "/tmp",
      config: { maxRetries: 2, waitTimeSeconds: 0, concurrency: 1 },
    });
    const startPromise = worker.start();
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 200);
    });
    await worker.stop();
    await startPromise.catch(() => {});
    expect(queue.nack).toHaveBeenCalledWith(
      expect.objectContaining({ buildId: "build-1" }),
      expect.objectContaining({ requeue: false }),
    );
  });

  it("handles nack failure gracefully", async () => {
    const job: PollableJob = { buildId: "build-1", attempts: 0, receipt: "r1" };
    const queue = createMockQueue([job]);
    queue.nack.mockRejectedValueOnce(new Error("nack failed"));
    const { db, storage, runner } = createFakeAdapters();
    const worker = createCaptureWorker({
      queue: queue as unknown as import("@storyshelf/core/adapter/capture-queue").CaptureQueue,
      db,
      storage,
      runner,
      scratchDir: "/tmp",
      config: { maxRetries: 2, waitTimeSeconds: 0, concurrency: 1 },
    });
    const startPromise = worker.start();
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 200);
    });
    await worker.stop();
    await startPromise.catch(() => {});
    expect(queue.nack).toHaveBeenCalled();
  });

  it("supports custom poll/ack/nack overrides", async () => {
    const job: PollableJob = { buildId: "build-1", attempts: 2, receipt: "r1" };
    let pollCalled = false;
    const customPoll = vi.fn(async () => {
      if (!pollCalled) {
        pollCalled = true;
        return job;
      }
      return null;
    });
    const customAck = vi.fn(async () => {});
    const customNack = vi.fn(async () => {});
    const queue = {
      metadata: {
        name: "mock",
        version: "0.0.0",
        kind: "mock",
        category: "capture-queue" as const,
      },
      enqueue: vi.fn(async () => {}),
      status: vi.fn(async () => null),
      active: vi.fn(async () => []),
      recent: vi.fn(async () => []),
    } as unknown as import("@storyshelf/core/adapter/capture-queue").CaptureQueue;
    const { db, storage, runner } = createFakeAdapters();
    const worker = createCaptureWorker({
      queue,
      poll: customPoll,
      ack: customAck,
      nack: customNack,
      db,
      storage,
      runner,
      scratchDir: "/tmp",
      config: { maxRetries: 0, waitTimeSeconds: 0, concurrency: 1 },
    });
    const startPromise = worker.start();
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 200);
    });
    await worker.stop();
    await startPromise.catch(() => {});
    expect(customPoll).toHaveBeenCalled();
    expect(customAck).toHaveBeenCalled();
  });

  it("isRunning reflects state", async () => {
    const queue = createMockQueue([]);
    const { db, storage, runner } = createFakeAdapters();
    const worker = createCaptureWorker({
      queue: queue as unknown as import("@storyshelf/core/adapter/capture-queue").CaptureQueue,
      db,
      storage,
      runner,
      scratchDir: "/tmp",
      config: { waitTimeSeconds: 0 },
    });
    expect(worker.isRunning()).toBe(false);
    const startPromise = worker.start();
    // Give loop a tick
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 50);
    });
    expect(worker.isRunning()).toBe(true);
    await worker.stop();
    await startPromise.catch(() => {});
    expect(worker.isRunning()).toBe(false);
  });

  it("start is idempotent when already running", async () => {
    const queue = createMockQueue([]);
    const { db, storage, runner } = createFakeAdapters();
    const worker = createCaptureWorker({
      queue: queue as unknown as import("@storyshelf/core/adapter/capture-queue").CaptureQueue,
      db,
      storage,
      runner,
      scratchDir: "/tmp",
      config: { waitTimeSeconds: 0 },
    });
    const p1 = worker.start();
    // Second start should return immediately
    await worker.start();
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 50);
    });
    await worker.stop();
    await p1.catch(() => {});
    expect(worker.isRunning()).toBe(false);
  });

  it("handles concurrency 2 with two jobs", async () => {
    const job1: PollableJob = { buildId: "build-1", attempts: 2, receipt: "r1" };
    const job2: PollableJob = { buildId: "build-2", attempts: 2, receipt: "r2" };
    const queue = createMockQueue([job1, job2]);
    const { db, storage, runner } = createFakeAdapters();
    const worker = createCaptureWorker({
      queue: queue as unknown as import("@storyshelf/core/adapter/capture-queue").CaptureQueue,
      db,
      storage,
      runner,
      scratchDir: "/tmp",
      config: { maxRetries: 0, waitTimeSeconds: 0, concurrency: 2 },
    });
    const startPromise = worker.start();
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 300);
    });
    await worker.stop();
    await startPromise.catch(() => {});
    expect(queue.ack).toHaveBeenCalledTimes(2);
  });

  it("stop is idempotent", async () => {
    const queue = createMockQueue([]);
    const { db, storage, runner } = createFakeAdapters();
    const worker = createCaptureWorker({
      queue: queue as unknown as import("@storyshelf/core/adapter/capture-queue").CaptureQueue,
      db,
      storage,
      runner,
      scratchDir: "/tmp",
      config: { waitTimeSeconds: 0 },
    });

    await worker.stop();
    await worker.stop();
    expect(worker.isRunning()).toBe(false);
  });

  it("works with custom tables and viewports", async () => {
    const queue = createMockQueue([]);
    const { db, storage, runner } = createFakeAdapters();
    const customTables = {
      projects: {} as never,
      builds: {} as never,
      buildLabels: {} as never,
      snapshots: {} as never,
      baselines: {} as never,
      projectStatusConfigs: {} as never,
    };
    const worker = createCaptureWorker({
      queue: queue as unknown as import("@storyshelf/core/adapter/capture-queue").CaptureQueue,
      db,
      storage,
      runner,
      scratchDir: "/tmp",
      tables: customTables,
      viewports: [{ name: "mobile", width: 375, height: 667 }],
      gitHosts: [],
      secret: "test-secret",
      config: { waitTimeSeconds: 0 },
    });
    expect(worker.isRunning()).toBe(false);
    await worker.stop();
  });

  it("handles queue without poll implementation", async () => {
    const queue = {
      metadata: {
        name: "mock",
        version: "0.0.0",
        kind: "mock",
        category: "capture-queue" as const,
      },
      enqueue: vi.fn(async () => {}),
      status: vi.fn(async () => null),
      active: vi.fn(async () => []),
      recent: vi.fn(async () => []),
    } as unknown as import("@storyshelf/core/adapter/capture-queue").CaptureQueue;
    const { db, storage, runner } = createFakeAdapters();
    const worker = createCaptureWorker({
      queue,
      db,
      storage,
      runner,
      scratchDir: "/tmp",
      config: { waitTimeSeconds: 0 },
    });
    const startPromise = worker.start();
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 100);
    });
    await worker.stop();
    await startPromise.catch(() => {});
    expect(worker.isRunning()).toBe(false);
  });
});
