import type { ShelfConfig, ShelfOptions } from "@storyshelf/core/config";
import { createShelfLogger, type Logger } from "@storyshelf/core/logger";
import { Retention } from "@storyshelf/core/retention";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShelfRouter } from "./app-types.ts";
import { attachLifecycle, type LifecycleCell } from "./lifecycle.ts";
import { startBranchGcTimer } from "./retention-timer.ts";
import type { ServerRuntime } from "./runtime.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Arm the timer for a database; returns a runner for the first scheduled sweep. */
async function arm(options: {
  capability: boolean;
  config: Record<string, unknown>;
  testing?: boolean;
}) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await db.insert(db.tables.projects, {
    id: "p",
    name: "P",
    slug: "p",
    createdAt: "2025-01-01",
    updatedAt: "2025-01-01",
  });
  if (options.capability) Object.assign(db, { buildReferenceLifecycle: {} });
  const purge = vi
    .spyOn(Retention.prototype, "purge")
    .mockResolvedValue({ removedBuilds: 2, removedFiles: 0 });
  vi.spyOn(Retention.prototype, "purgeStaleBranches").mockResolvedValue({
    removedBranches: 0,
    removedBaselines: 0,
  });
  const warn = vi.fn();
  const error = vi.fn();
  const logger = { info: vi.fn(), warn, error, debug: vi.fn() } as unknown as Logger;
  const schedule = vi.spyOn(globalThis, "setTimeout");
  const timer = startBranchGcTimer(
    db,
    storage,
    { branchGcIntervalMs: 120_000, ...options.config } as ShelfConfig,
    logger,
    options.testing ?? false,
  );
  const scheduled = schedule.mock.calls.find((args) => args[1] === 120_000)?.[0];
  const run = async (): Promise<void> => {
    if (typeof scheduled !== "function") throw new Error("retention timer was not scheduled");
    await (scheduled as () => Promise<void>)();
  };
  return { db, timer, run, purge, warn, error };
}

describe("background retention", () => {
  it.each([
    { testing: true, capability: false, runs: false },
    { testing: false, capability: false, runs: true },
    { testing: true, capability: true, runs: true },
  ])(
    "runs branch GC unless a testing deployment lacks the lifecycle capability (%o)",
    async ({ testing, capability, runs }) => {
      const { db } = makeDatabase();
      if (capability) Object.assign(db, { buildReferenceLifecycle: {} });
      const { storage } = makeStorage();
      await db.insert(db.tables.projects, {
        id: "p",
        name: "P",
        slug: "p",
        createdAt: "2025-01-01",
        updatedAt: "2025-01-01",
      });
      await db.insert(db.tables.aiUsage, {
        id: "expired",
        projectId: "p",
        createdAt: "2020-01-01T00:00:00.000Z",
      });
      const purge = vi.spyOn(Retention.prototype, "purgeStaleBranches");
      const schedule = vi.spyOn(globalThis, "setTimeout");
      const app = {} as ShelfRouter;
      const options = {
        database: db,
        storage,
        ...(testing ? { testing: {} } : {}),
      } as ShelfOptions;
      const runtime = {
        config: { branchGcIntervalMs: 120_000 },
        logger: createShelfLogger({ level: "silent" }),
      } as unknown as ServerRuntime;
      const cell: LifecycleCell = {
        ready: Promise.resolve({ ok: true, failures: [] }),
        settled: null,
      };
      attachLifecycle(app, options, runtime, cell);
      const scheduled = schedule.mock.calls.find((args) => args[1] === 120_000)?.[0];
      expect(typeof scheduled).toBe("function");
      if (typeof scheduled !== "function") throw new Error("retention timer was not scheduled");
      await (scheduled as () => Promise<void>)();
      expect(purge.mock.calls.length > 0).toBe(runs);
      expect(await db.get(db.tables.aiUsage, "expired")).toBeNull();
      await (app as unknown as { lifecycle: { teardown(): Promise<void> } }).lifecycle.teardown();
    },
  );

  describe("scheduled build purge (opt-in)", () => {
    it("purges builds older than purgeTtlDays through the capability, keeping each branch's latest", async () => {
      const { timer, run, purge } = await arm({ capability: true, config: { purgeTtlDays: 14 } });
      await run();
      expect(purge).toHaveBeenCalledWith(expect.objectContaining({ id: "p" }), {
        ttlDays: 14,
        keepLatestPerBranch: true,
      });
      timer?.stop();
    });

    it("never purges builds when purgeTtlDays is not set, whatever the database supports", async () => {
      const { timer, run, purge } = await arm({ capability: true, config: {} });
      await run();
      expect(purge).not.toHaveBeenCalled();
      timer?.stop();
    });

    it("deletes nothing without the capability, and says so once", async () => {
      const { timer, run, purge, warn } = await arm({
        capability: false,
        config: { purgeTtlDays: 14 },
      });
      await run();
      await run();
      expect(purge).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      timer?.stop();
    });

    it("still cleans AI data when the build purge fails", async () => {
      const { db, timer, run, purge, error } = await arm({
        capability: true,
        config: { purgeTtlDays: 14 },
      });
      await db.insert(db.tables.aiUsage, {
        id: "expired",
        projectId: "p",
        createdAt: "2020-01-01T00:00:00.000Z",
      });
      purge.mockRejectedValue(new Error("storage down"));

      await run();

      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ stage: "build purge" }),
        "retention sweep stage failed",
      );
      expect(await db.get(db.tables.aiUsage, "expired")).toBeNull();
      timer?.stop();
    });

    it("still runs when branch GC is off, because the build purge is on", async () => {
      const { timer, run, purge } = await arm({
        capability: true,
        config: { purgeTtlDays: 14, branchTtlDays: null },
      });
      expect(timer).not.toBeNull();
      await run();
      expect(purge).toHaveBeenCalledTimes(1);
      timer?.stop();
    });

    it("schedules nothing when both are off", async () => {
      const { db } = makeDatabase();
      const { storage } = makeStorage();
      const logger = createShelfLogger({ level: "silent" });
      expect(
        startBranchGcTimer(db, storage, { branchTtlDays: null } as ShelfConfig, logger),
      ).toBeNull();
    });
  });
});
