import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { ConsumerJob, JobRunContext } from "@storyshelf/core/capture";
import type { ShelfOptions } from "@storyshelf/core/config";
import { createShelfLogger } from "@storyshelf/core/logger";
import { BuildModel, ProjectModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { alreadyAlerted } from "./capture-alerts.ts";
import { setupCapture } from "./capture-setup.ts";
import { createJobQueue } from "./job-queue.ts";

const ECHO_CHILD = fileURLToPath(
  new URL("../../core/src/test-helpers/ipc-echo-child.ts", import.meta.url),
);

const logger = createShelfLogger({ level: "silent" });

function runner() {
  return {
    metadata: { name: "mock", version: "0.0.0", kind: "mock", category: "capture-runner" as const },
    render: vi.fn(async () => ({ captures: [], failures: [] })),
    cancel: vi.fn(async () => {}),
  } as unknown as import("@storyshelf/core/adapter/capture-runner").CaptureRunner;
}

/** Wire capture for `testing` over a fresh in-memory database. */
const SCRATCH = { scratchDir: ".tmp/capture-setup-test" };

function wire(testing?: ShelfOptions["testing"], config: { scratchDir?: string } = SCRATCH) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const options = { database: db, storage, testing } as unknown as ShelfOptions;
  const jobs = createJobQueue(options, ["capture"], testing?.retries ?? 2);
  return {
    db,
    jobs,
    wiring: setupCapture(
      options,
      config,
      {
        notifiers: [],
        buildState: { request: async () => {} },
        publicOrigin: async () => await Promise.resolve("https://shelf.example.com"),
      },
      logger,
      jobs,
    ),
    options,
  };
}

const runContext = (): JobRunContext => ({ logger: {} as never, touch: () => {} });

describe("setupCapture", () => {
  it("wires nothing without testing", () => {
    const { wiring } = wire();
    expect(wiring).toEqual({ queue: null, enqueueCapture: undefined, handler: null });
  });

  it("queues captures on the database queue and runs them here when there is a runner", async () => {
    const { wiring, jobs } = wire({ runner: runner() });
    expect(wiring.queue?.metadata.kind).toBe("database");
    expect(wiring.handler).not.toBeNull();
    await wiring.enqueueCapture?.("build-1", "req-1");
    expect(await jobs.get().poll()).toMatchObject({
      kind: "capture",
      buildId: "build-1",
      reqId: "req-1",
      maxAttempts: 3,
    });
  });

  it("stamps testing.retries on the jobs", async () => {
    const { wiring, jobs } = wire({ runner: runner(), retries: 0 });
    await wiring.enqueueCapture?.("build-1");
    expect(await jobs.get().poll()).toMatchObject({ maxAttempts: 1 });
  });

  it("falls back to the default scratch dir when none is configured", () => {
    const { wiring } = wire({ runner: runner() }, {} as never);
    expect(wiring.handler).not.toBeNull();
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
      const { wiring, jobs } = wire({ runner: runner() });
      await trace.getTracer("test").startActiveSpan("test.enqueue", async () => {
        await wiring.enqueueCapture?.("build-1", "req-1");
      });
      expect(await jobs.get().poll()).toMatchObject({
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

  it("fails a build whose capture job lost its last lease, and alerts", async () => {
    const { db, jobs } = wire({ runner: runner() });
    const project = await new ProjectModel(db).create({ name: "Exhausted" });
    const builds = new BuildModel(db);
    const build = await builds.create(project.id, { gitSha: "sha", gitBranch: "feature/x" });
    await builds.setStatus(build.id, "capturing");
    await jobs.exhausted.capture?.(
      { buildId: build.id, kind: "capture" } as never,
      "lease expired on the final attempt",
    );
    const failed = await builds.get(build.id);
    expect(failed?.status).toBe("failed");
    expect(alreadyAlerted(failed as never)).toBe(true);
  });
});

const forked = () => wire({ runner: runner(), workerEntry: ECHO_CHILD, mode: "fork" });
const job = (buildId: string, extra: Partial<ConsumerJob> = {}): ConsumerJob => ({
  buildId,
  receipt: `${buildId}:1`,
  attempts: 0,
  ...extra,
});

describe("the forked capture handler", () => {
  it("is chosen when forking is forced, and a real child runs the pushed jobs", async () => {
    const { wiring } = forked();
    try {
      expect(wiring.handler?.close).toBeTypeOf("function");
      await wiring.handler?.run(job("ok-1"), runContext());
      await expect(wiring.handler?.run(job("fail-1"), runContext())).rejects.toThrow(
        "fail-1 failed",
      );
    } finally {
      await wiring.handler?.close?.();
    }
  }, 30_000);

  it("alerts for a build the capture left failed, and on a last attempt that threw", async () => {
    const { wiring, db } = forked();
    const project = await new ProjectModel(db).create({ name: "Alerting" });
    const builds = new BuildModel(db);
    const failedBuild = await builds.create(project.id, { gitSha: "a", gitBranch: "feature/x" });
    await builds.setStatus(failedBuild.id, "failed");
    const lastBuild = await builds.create(project.id, { gitSha: "b", gitBranch: "feature/y" });
    await builds.setStatus(lastBuild.id, "failed");
    try {
      await wiring.handler?.run(job(failedBuild.id), runContext());
      expect(alreadyAlerted((await builds.get(failedBuild.id)) as never)).toBe(true);
      const last = job(`fail-${lastBuild.id}`, { attempt: 3, maxAttempts: 3, attempts: 2 });
      await expect(wiring.handler?.run(last, runContext())).rejects.toThrow(/failed/u);
    } finally {
      await wiring.handler?.close?.();
    }
  }, 30_000);

  it("keeps the in-process handler's own validation of what it accepts", () => {
    const { wiring } = forked();
    expect(wiring.handler?.accepts?.(job("b1"))).toBe(true);
    expect(wiring.handler?.accepts?.(job(""))).toBe(false);
  });
});
