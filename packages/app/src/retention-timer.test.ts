import { createShelfLogger } from "@storyshelf/core/logger";
import { Retention } from "@storyshelf/core/retention";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startBranchGcTimer } from "./retention-timer.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("background retention", () => {
  it.each([true, false])(
    "runs branch GC only outside testing mode (testing=%s)",
    async (testing) => {
      vi.useFakeTimers();
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
      const timer = startBranchGcTimer(
        db,
        storage,
        { branchGcIntervalMs: 100 },
        createShelfLogger({ level: "silent" }),
        testing,
      );
      await vi.advanceTimersByTimeAsync(100);
      expect(purge.mock.calls.length > 0).toBe(!testing);
      timer?.stop();
    },
  );
});
