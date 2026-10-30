import { createShelfLogger } from "@storyshelf/core/logger";
import { Retention } from "@storyshelf/core/retention";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBranchGcRunner } from "./retention-timer.ts";

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
      const run = createBranchGcRunner(
        db,
        storage,
        createShelfLogger({ level: "silent" }),
        30,
        testing,
      );
      await run();
      expect(purge.mock.calls.length > 0).toBe(!testing);
    },
  );
});
