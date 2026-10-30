import type { ShelfOptions } from "@storyshelf/core/config";
import { createShelfLogger } from "@storyshelf/core/logger";
import { Retention } from "@storyshelf/core/retention";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { setImmediate as nextTurn } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShelfRouter } from "./app-types.ts";
import { attachLifecycle, type LifecycleCell } from "./lifecycle.ts";
import type { ServerRuntime } from "./runtime.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("background retention", () => {
  it.each([true, false])(
    "runs branch GC only outside testing mode (testing=%s)",
    async (testing) => {
      const { db } = makeDatabase();
      const { storage } = makeStorage();
      await db.insert(db.tables.projects, {
        id: "p",
        name: "P",
        slug: "p",
        createdAt: "2025-01-01",
        updatedAt: "2025-01-01",
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
      scheduled();
      await nextTurn();
      expect(purge.mock.calls.length > 0).toBe(!testing);
      await (app as unknown as { lifecycle: { teardown(): Promise<void> } }).lifecycle.teardown();
    },
  );
});
