import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { createShelfLogger } from "@storyshelf/core/logger";
import { BuildModel, ProjectModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { describe, expect, it, vi } from "vitest";
import { alreadyAlerted, setupCaptureQueue } from "./capture-setup.ts";

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

describe("alreadyAlerted", () => {
  it("lets only the first of several settles of one failed build through", () => {
    const build = { id: "b-alert", updatedAt: "2026-10-19T10:00:00.000Z" };
    expect(alreadyAlerted(build)).toBe(false);
    // Every other shard of the same failed build settles against the same build row.
    expect(alreadyAlerted(build)).toBe(true);
    expect(alreadyAlerted({ ...build })).toBe(true);
  });

  it("alerts again when a retry fails the build anew", () => {
    expect(alreadyAlerted({ id: "b-retry", updatedAt: "2026-10-19T10:00:00.000Z" })).toBe(false);
    expect(alreadyAlerted({ id: "b-retry", updatedAt: "2026-10-19T11:30:00.000Z" })).toBe(false);
  });
});

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

  it("falls back to the default scratch dir when none is configured", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const result = setupCaptureQueue(
      { database: db as never, storage: storage as never, capture: { runner: makeRunner() } },
      {},
      [],
      makeLogger(),
    );
    expect(result.queue?.metadata.kind).toBe("memory");
  });

  it("creates InMemory queue when runner and scratchDir provided", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const result = setupCaptureQueue(
      { database: db as never, storage: storage as never, capture: { runner: makeRunner() } },
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
      { database: db as never, storage: storage as never, capture: { queue } },
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
        capture: { queue, runner: makeRunner() },
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
        capture: { queue, runner: makeRunner() },
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

  it("respects capture.concurrency", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const result = setupCaptureQueue(
      {
        database: db as never,
        storage: storage as never,
        capture: { runner: makeRunner(), concurrency: 5 },
      },
      { scratchDir: "/tmp" },
      [],
      makeLogger(),
    );
    expect(result.queue).not.toBeNull();
  });

  it("propagates the active traceparent on enqueue", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    const manager = new AsyncLocalStorageContextManager();
    context.setGlobalContextManager(manager.enable());
    try {
      const { db } = makeDatabase();
      const { storage } = makeStorage();
      const queue = makeQueue();
      const result = setupCaptureQueue(
        { database: db as never, storage: storage as never, capture: { queue } },
        {},
        [],
        makeLogger(),
      );
      await trace.getTracer("test").startActiveSpan("test.enqueue", async () => {
        await result.enqueueCapture?.("build-1", "req-1");
      });
      expect(queue.enqueue).toHaveBeenCalledWith({
        buildId: "build-1",
        reqId: "req-1",
        traceparent: expect.stringMatching(/^00-/u),
      });
    } finally {
      await provider.shutdown();
      context.disable();
      propagation.disable();
      trace.disable();
    }
  });

  it("exposes a stuck-build sweep only for the in-process queue", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const inProcess = setupCaptureQueue(
      { database: db as never, storage: storage as never, capture: { runner: makeRunner() } },
      { scratchDir: "/tmp" },
      [],
      makeLogger(),
    );
    const remote = setupCaptureQueue(
      { database: db as never, storage: storage as never, capture: { queue: makeQueue() } },
      {},
      [],
      makeLogger(),
    );
    expect(inProcess.recoverStuck).toBeDefined();
    expect(remote.recoverStuck).toBeUndefined();
  });

  it("requeues a build left capturing by a restart", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const project = await new ProjectModel(db as never).create({ name: "Stuck" });
    const builds = new BuildModel(db as never);
    const build = await builds.create(project.id, { gitSha: "sha", gitBranch: "feature/x" });
    await builds.setStatus(build.id, "capturing");
    const { recoverStuck } = setupCaptureQueue(
      { database: db as never, storage: storage as never, capture: { runner: makeRunner() } },
      { scratchDir: "/tmp" },
      [],
      makeLogger(),
    );

    const result = await recoverStuck?.();

    expect(result).toEqual({ requeued: [build.id], failed: [] });
  });
});
