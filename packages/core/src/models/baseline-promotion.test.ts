import { describe, expect, it } from "vitest";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { BaselinePromotionRefused } from "./baseline-promotion-refused.ts";
import { assertBuildLive } from "./baseline-promotion.ts";

const NOW = "2026-01-01T00:00:00.000Z";

async function seeded(patch: Record<string, unknown> = {}) {
  const { db } = makeDatabase();
  await db.insert(db.tables.builds, {
    id: "b1",
    projectId: "p1",
    gitSha: "sha",
    gitBranch: "main",
    status: "capturing",
    captureGeneration: 2,
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  } as never);
  return db;
}

describe("assertBuildLive", () => {
  it("passes for a live build at the run's generation, or when no generation is asked", async () => {
    const db = await seeded();
    await expect(assertBuildLive(db, { id: "b1", generation: 2 })).resolves.toBeUndefined();
    await expect(assertBuildLive(db, { id: "b1" })).resolves.toBeUndefined();
  });

  it("refuses a cancelled build, a missing one and a stale generation", async () => {
    const cancelled = await seeded({ status: "cancelled" });
    await expect(assertBuildLive(cancelled, { id: "b1" })).rejects.toBeInstanceOf(
      BaselinePromotionRefused,
    );
    const live = await seeded();
    await expect(assertBuildLive(live, { id: "gone" })).rejects.toBeInstanceOf(
      BaselinePromotionRefused,
    );
    await expect(assertBuildLive(live, { id: "b1", generation: 1 })).rejects.toThrow("stale");
  });

  it("reads a build without a generation as generation 0", async () => {
    const db = await seeded({ captureGeneration: undefined });
    await expect(assertBuildLive(db, { id: "b1", generation: 0 })).resolves.toBeUndefined();
  });
});
