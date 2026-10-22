import type { ShelfOptions } from "@storyshelf/core/config";
import { createShelfLogger } from "@storyshelf/core/logger";
import { makeDatabase } from "@storyshelf/core/test-helpers";
import { describe, expect, it, vi } from "vitest";
import { runBootTasks } from "./boot-tasks.ts";
import type { LifecycleCell } from "./lifecycle.ts";
import type { ServerRuntime } from "./runtime.ts";

const logger = createShelfLogger({ level: "silent" });

function consumer() {
  let running = false;
  return {
    start: vi.fn(async () => {
      running = true;
      await new Promise(() => {});
    }),
    stop: vi.fn(async () => {}),
    isRunning: () => running,
  };
}

function boot(
  ready: { ok: boolean },
  extra: Partial<LifecycleCell> & {
    logger?: ServerRuntime["logger"];
    notifiers?: unknown[];
    origin?: string;
  } = {},
) {
  const { db } = makeDatabase();
  const fake = consumer();
  const cell: LifecycleCell = {
    ready: Promise.resolve({ ...ready, failures: [] }),
    settled: null,
    consumer: fake,
    ...(extra.consumer === undefined ? {} : { consumer: extra.consumer }),
    ...(extra.consumerStopped === undefined ? {} : { consumerStopped: extra.consumerStopped }),
  };
  const runtime = {
    config: {},
    logger: extra.logger ?? logger,
    notifiers: extra.notifiers ?? [],
    publicOrigin: { url: async () => await Promise.resolve(extra.origin) },
  } as unknown as ServerRuntime;
  runBootTasks(cell, { database: db } as unknown as ShelfOptions, runtime);
  return { cell, fake };
}

describe("runBootTasks", () => {
  it("starts the job consumer once adapters are ready, so a host that never calls setup() runs jobs", async () => {
    const { cell, fake } = boot({ ok: true });
    await Promise.all(cell.background ?? []);
    expect(fake.start).toHaveBeenCalledOnce();
  });

  it("starts nothing when setup failed", async () => {
    const { cell, fake } = boot({ ok: false });
    await Promise.all(cell.background ?? []);
    expect(fake.start).not.toHaveBeenCalled();
  });

  it("does not restart a consumer that teardown already stopped", async () => {
    const { cell, fake } = boot({ ok: true }, { consumerStopped: true });
    await Promise.all(cell.background ?? []);
    expect(fake.start).not.toHaveBeenCalled();
  });

  it("does not touch the queue of a host that has no consumer", async () => {
    const { cell } = boot({ ok: true }, { consumer: null });
    await expect(Promise.all(cell.background ?? [])).resolves.toBeDefined();
  });

  it("says so at boot when notifiers are wired but no public origin resolves", async () => {
    const warn = vi.fn();
    const spy = { ...logger, warn } as unknown as ServerRuntime["logger"];
    const { cell } = boot({ ok: true }, { logger: spy, notifiers: [{}] });
    await Promise.all(cell.background ?? []);
    expect(warn).toHaveBeenCalledWith({}, expect.stringContaining("Notifications are paused"));
  });

  it("stays quiet with an origin, or with nothing to notify through", async () => {
    const warn = vi.fn();
    const spy = { ...logger, warn } as unknown as ServerRuntime["logger"];
    const withOrigin = boot(
      { ok: true },
      { logger: spy, notifiers: [{}], origin: "https://shelf.example.com" },
    );
    const none = boot({ ok: true }, { logger: spy });
    await Promise.all([...(withOrigin.cell.background ?? []), ...(none.cell.background ?? [])]);
    expect(warn).not.toHaveBeenCalled();
  });
});
