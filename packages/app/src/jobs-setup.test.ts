import type { StateNotifierProvider } from "@storyshelf/core/adapter/notifier";
import { createDatabaseCaptureQueue } from "@storyshelf/core/capture";
import type { ShelfOptions } from "@storyshelf/core/config";
import { createShelfLogger } from "@storyshelf/core/logger";
import { NotificationChannelModel } from "@storyshelf/core/models";
import {
  createManualClock,
  createTestBuild,
  createTestProject,
  deferred,
  makeDatabase,
  makeStorage,
} from "@storyshelf/core/test-helpers";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { setupJobs } from "./jobs-setup.ts";
import { resolveRuntime } from "./runtime.ts";
import { stubRunner } from "./test-runner.ts";

const logger = createShelfLogger({ level: "silent" });
const SECRET = "test-server-secret-32-chars-long!!";

function blockingStateProvider(gate: Promise<void>, entered: () => void): StateNotifierProvider {
  const metadata = {
    name: "Blocking Git",
    version: "0.0.0",
    kind: "slow-git",
    category: "notifier",
    delivery: "state",
    schema: z.object({}).loose(),
  } as const;
  return {
    metadata,
    create: () => ({
      metadata,
      setState: async () => {
        entered();
        await gate;
      },
    }),
  };
}

function wire(testing?: ShelfOptions["testing"], env: NodeJS.ProcessEnv = {}) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const options = { database: db, storage, logger, testing } as unknown as ShelfOptions;
  return { db, wiring: setupJobs(options, resolveRuntime(options), env) };
}

describe("setupJobs", () => {
  it("cancels a build's jobs of every kind", async () => {
    const { db, wiring } = wire({ runner: stubRunner() });
    const shared = createDatabaseCaptureQueue(db, { kinds: ["notify"] });
    await shared.enqueueJob({ kind: "notify", buildId: "b1" });
    await shared.enqueueJob({ kind: "publish", buildId: "b1" });
    await shared.enqueueJob({ kind: "notify", buildId: "b2" });
    expect(await wiring.cancelBuildJobs("b1")).toBe(true);
    expect((await shared.poll())?.buildId).toBe("b2");
    expect(await shared.poll()).toBeNull();
  });

  it("reports nothing to cancel for a build without unfinished jobs", async () => {
    const { wiring } = wire({ runner: stubRunner() });
    expect(await wiring.cancelBuildJobs("none")).toBe(false);
  });

  it("hosting only on a long-running host: publishes through one consumer, captures nothing", () => {
    const { wiring } = wire();
    expect(wiring.captureQueue).toBeNull();
    expect(wiring.enqueueCapture).toBeUndefined();
    expect(wiring.capturesHere).toBe(false);
    expect(wiring.publish.enqueuePublish).toBeTypeOf("function");
    expect(wiring.consumer?.isRunning()).toBe(false);
  });

  it("hosting only on a serverless host: no queue, no consumer", () => {
    const { wiring } = wire(undefined, { VERCEL: "1" });
    expect(wiring.consumer).toBeNull();
    expect(wiring.publish.enqueuePublish).toBeUndefined();
  });

  it("testing with a runner: captures and publishes on the database queue, consumed here", async () => {
    const { wiring } = wire({ runner: stubRunner() });
    expect(wiring.captureQueue?.metadata.kind).toBe("database");
    expect(wiring.capturesHere).toBe(true);
    expect(wiring.enqueueCapture).toBeTypeOf("function");
    await wiring.enqueueCapture?.("build-1", "req-1");
    expect(await wiring.captureQueue?.active()).toEqual([
      expect.objectContaining({ buildId: "build-1", status: "queued" }),
    ]);
    expect(wiring.consumer).not.toBeNull();
  });

  it("testing with a runner on a serverless host still consumes captures (it was warned about)", () => {
    const { wiring } = wire({ runner: stubRunner() }, { VERCEL: "1" });
    expect(wiring.capturesHere).toBe(true);
    expect(wiring.publish.enqueuePublish).toBeUndefined();
    expect(wiring.consumer).not.toBeNull();
  });

  it("starts, serves a database job and drains", async () => {
    const { wiring } = wire({ runner: stubRunner() });
    const running = wiring.consumer?.start();
    await wiring.enqueueCapture?.("missing-build");
    // The build does not exist: the handler fails the attempt (it is retried later), and the
    // consumer carries on. What matters is that the job was claimed.
    await vi.waitFor(async () => {
      expect((await wiring.captureQueue?.status("missing-build"))?.startedAt).toBeDefined();
    });
    await wiring.consumer?.stop();
    await running;
  });

  it("runs the notify consumer's lease keeper on the injected queue clock", async () => {
    const clock = createManualClock();
    const delays: number[] = [];
    const timers = {
      setTimeout: (callback: () => void, ms: number) => {
        delays.push(ms);
        return clock.timers.setTimeout(callback, ms);
      },
      clearTimeout: (handle: unknown) => {
        clock.timers.clearTimeout(handle);
      },
    };
    const gate = deferred();
    const entered = deferred();
    const provider = blockingStateProvider(gate.promise, () => {
      entered.resolve();
    });
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const options = {
      database: db,
      storage,
      logger,
      config: { secret: SECRET, publicBaseUrl: "https://shelf.example.com" },
      testing: { runner: stubRunner(), queueClock: { now: clock.now, timers } },
      notifications: { notifiers: [provider] },
    } as unknown as ShelfOptions;
    const project = await createTestProject(db, db.tables);
    const build = await createTestBuild(db, db.tables, project.id);
    await new NotificationChannelModel(db, undefined, SECRET).create({
      projectId: project.id,
      provider: "slow-git",
      config: {},
      secret: "token",
    });
    const wiring = setupJobs(options, resolveRuntime(options));
    await wiring.buildState.request(build.id);

    const running = wiring.consumer?.start();
    try {
      await entered.promise;
      // The handler is blocked in the git host; its keeper checks cancellation every 5 s and
      // renews the 5 min lease every 30 s, on the notify queue's injected clock.
      expect(delays).toContain(5_000);
      expect(delays).toContain(30_000);
    } finally {
      gate.resolve();
      await wiring.consumer?.stop();
      await running;
    }
  });
});
