import type { Auth } from "@storyshelf/core/auth";
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
  ready?: () => Promise<{ ok: boolean }>;
}) {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
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
    options.ready,
  );
  const scheduled = schedule.mock.calls.find((args) => args[1] === 120_000)?.[0];
  const run = async (): Promise<void> => {
    if (typeof scheduled !== "function") throw new Error("retention timer was not scheduled");
    await (scheduled as () => Promise<void>)();
  };
  return { db, storage, objects, timer, run, purge, warn, error };
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
    it("reads the capability once for a pass over several projects", async () => {
      const { db, timer, run, purge } = await arm({
        capability: true,
        config: { purgeTtlDays: 14 },
      });
      await db.insert(db.tables.projects, {
        id: "q",
        name: "Q",
        slug: "q",
        createdAt: "2025-01-01",
        updatedAt: "2025-01-01",
      });
      const original = db.buildReferenceLifecycle;
      // The capability goes away as soon as the first project's purge has started.
      purge.mockImplementationOnce(async () => {
        Object.assign(db, { buildReferenceLifecycle: undefined });
        return await Promise.resolve({ removedBuilds: 0, removedFiles: 0 });
      });
      await run();
      expect(purge).toHaveBeenCalledTimes(2);
      for (const [, options] of purge.mock.calls) expect(options.lifecycle).toBe(original);
      timer?.stop();
    });

    it("purges builds older than purgeTtlDays through the capability, keeping each branch's latest", async () => {
      const { db, timer, run, purge } = await arm({
        capability: true,
        config: { purgeTtlDays: 14 },
      });
      await run();
      // The capability read at the start of the pass is the one handed to the deletion.
      expect(purge).toHaveBeenCalledWith(expect.objectContaining({ id: "p" }), {
        ttlDays: 14,
        keepLatestPerBranch: true,
        lifecycle: db.buildReferenceLifecycle,
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

    it("reclaims per-build copies whose blob exists, keeping the manifest, and resumes next sweep", async () => {
      const hash = "a".repeat(64);
      const { db, objects, run } = await arm({ capability: false, config: {} });
      await db.insert(db.tables.builds, {
        id: "b1",
        projectId: "p",
        gitSha: "x",
        gitBranch: "main",
        status: "approved",
        retentionState: "available",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      objects.set(
        "p/builds/b1/storybook/manifest.json",
        Buffer.from(JSON.stringify({ "a.js": hash })),
      );
      objects.set("p/builds/b1/storybook/a.js", Buffer.from("a"));
      objects.set(`content/${hash}`, Buffer.from("a"));
      await run();
      expect(objects.has("p/builds/b1/storybook/a.js")).toBe(false);
      expect(objects.has("p/builds/b1/storybook/manifest.json")).toBe(true);
      expect(objects.has(`content/${hash}`)).toBe(true);
    });

    it("stops the copy reclaim when the timer is stopped", async () => {
      const { db, objects, run, timer } = await arm({ capability: false, config: {} });
      await db.insert(db.tables.builds, {
        id: "b1",
        projectId: "p",
        gitSha: "x",
        gitBranch: "main",
        status: "approved",
        retentionState: "available",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      const hash = "a".repeat(64);
      objects.set(
        "p/builds/b1/storybook/manifest.json",
        Buffer.from(JSON.stringify({ "a.js": hash })),
      );
      objects.set("p/builds/b1/storybook/a.js", Buffer.from("a"));
      objects.set(`content/${hash}`, Buffer.from("a"));
      timer?.stop();
      await run();
      expect(objects.has("p/builds/b1/storybook/a.js")).toBe(true);
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

    it("skips branch GC while retention is paused, even without testing", async () => {
      const { db, timer, run } = await arm({ capability: false, config: {} });
      Object.assign(db, {
        retentionPause: { baselineId: "B", buildId: "S", problem: "tombstoned" },
      });
      const branches = vi.spyOn(Retention.prototype, "purgeStaleBranches");
      await run();
      expect(branches).not.toHaveBeenCalled();
      timer?.stop();
    });

    it("waits for adapter setup before any sweep, and skips them when setup failed", async () => {
      const setup = Promise.withResolvers<{ ok: boolean }>();
      const { timer, run } = await arm({
        capability: false,
        config: {},
        ready: async () => await setup.promise,
      });
      const branches = vi.spyOn(Retention.prototype, "purgeStaleBranches");
      const sweep = run();
      await Promise.resolve();
      expect(branches).not.toHaveBeenCalled();
      setup.resolve({ ok: false });
      await sweep;
      expect(branches).not.toHaveBeenCalled();
      timer?.stop();
    });

    it("does not sweep after stop() when setup finishes during shutdown", async () => {
      const setup = Promise.withResolvers<{ ok: boolean }>();
      const { timer, run } = await arm({
        capability: false,
        config: {},
        ready: async () => await setup.promise,
      });
      const branches = vi.spyOn(Retention.prototype, "purgeStaleBranches");
      const sweep = run();
      timer?.stop();
      setup.resolve({ ok: true });
      await sweep;
      expect(branches).not.toHaveBeenCalled();
    });

    it("sweeps once adapter setup has succeeded", async () => {
      const { timer, run } = await arm({
        capability: false,
        config: {},
        ready: async () => await Promise.resolve({ ok: true }),
      });
      const branches = vi.spyOn(Retention.prototype, "purgeStaleBranches");
      await run();
      expect(branches).toHaveBeenCalled();
      timer?.stop();
    });

    it("schedules nothing when the interval is not positive", async () => {
      const { db } = makeDatabase();
      const { storage } = makeStorage();
      const logger = createShelfLogger({ level: "silent" });
      expect(
        startBranchGcTimer(db, storage, { branchGcIntervalMs: 0 } as ShelfConfig, logger),
      ).toBeNull();
    });

    it("sweeps expired auth rows with the configured window", async () => {
      vi.useFakeTimers();
      const { db } = makeDatabase();
      const { storage } = makeStorage();
      const logger = createShelfLogger({ level: "silent" });
      const purgeExpired = vi.fn().mockResolvedValue({ sessions: 1, verifications: 2 });
      const auth = { purgeExpired } as unknown as Auth;
      const config = { branchTtlDays: null, expiredAuthTtlDays: 3 } as ShelfConfig;
      const timer = startBranchGcTimer(db, storage, config, logger, false, undefined, auth);
      await vi.advanceTimersByTimeAsync(3_600_001);
      timer?.stop();
      vi.useRealTimers();
      expect(purgeExpired).toHaveBeenCalledOnce();
      const cutoff = Date.parse(purgeExpired.mock.calls[0]?.[0] as string);
      // The sweep ran 1h after the timer started, so the cutoff is 3 days before that moment.
      expect(Date.now() - cutoff).toBeGreaterThan(3 * 86_400_000 - 3_700_000);
      expect(Date.now() - cutoff).toBeLessThan(3 * 86_400_000);
    });

    it("keeps expired auth rows when the window is null", async () => {
      vi.useFakeTimers();
      const { db } = makeDatabase();
      const { storage } = makeStorage();
      const logger = createShelfLogger({ level: "silent" });
      const purgeExpired = vi.fn();
      const auth = { purgeExpired } as unknown as Auth;
      const config = { branchTtlDays: null, expiredAuthTtlDays: null } as ShelfConfig;
      const timer = startBranchGcTimer(db, storage, config, logger, false, undefined, auth);
      await vi.advanceTimersByTimeAsync(3_600_001);
      timer?.stop();
      vi.useRealTimers();
      expect(purgeExpired).not.toHaveBeenCalled();
    });
  });
});
