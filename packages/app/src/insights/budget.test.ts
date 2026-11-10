import { AiUsageModel } from "@storyshelf/core/models";
import { makeDatabase } from "@storyshelf/core/test-helpers";
import { describe, expect, it, vi } from "vite-plus/test";
import { recordUsage, reserveBudget } from "./budget.ts";
import type { InsightDeps } from "./deps.ts";
import { fakeAi } from "./test-support.ts";

const reservation = { projectId: "p1", profile: "default", task: "triage", model: "m" };

function depsWith(
  db: ReturnType<typeof makeDatabase>["db"],
  options: { dailyTokens?: number; perHour?: number } = {},
): InsightDeps {
  const ai = fakeAi(options.dailyTokens === undefined ? {} : { dailyTokens: options.dailyTokens });
  const budget = ai.budget();
  ai.budget = () => ({ ...budget, perProjectCallsPerHour: options.perHour ?? 3 });
  return {
    ai,
    db,
    storage: {} as never,
    logger: { warn: () => 0, info: () => 0 } as never,
    notify: { notifiers: [] } as never,
  };
}

describe("reserveBudget", () => {
  it("lets exactly the hourly limit of concurrent requests through, the rest get a 429", async () => {
    const { db } = makeDatabase();
    const deps = depsWith(db);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, async () => await reserveBudget(deps, reservation)),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    const refused = results.filter((result) => result.status === "rejected");
    expect(refused).toHaveLength(7);
    expect(refused[0]).toMatchObject({ reason: { status: 429 } });
  });

  it("gives the reservation back when the daily token cap is already spent", async () => {
    const { db } = makeDatabase();
    const deps = depsWith(db, { dailyTokens: 10 });
    await new AiUsageModel(db).record({
      insightId: null,
      ...reservation,
      inputTokens: 50,
      outputTokens: 0,
      estimated: false,
      images: 0,
      status: "ok",
    });
    await expect(reserveBudget(deps, reservation)).rejects.toMatchObject({ status: 429 });
    const rows = await new AiUsageModel(db).listSince("2000-01-01T00:00:00.000Z");
    expect(rows).toHaveLength(1);
  });

  it("gives the reservation back when today's usage cannot be read", async () => {
    const { db } = makeDatabase();
    const deps = depsWith(db, { dailyTokens: 10 });
    const read = vi
      .spyOn(AiUsageModel.prototype, "listSince")
      .mockRejectedValueOnce(new Error("db down"));
    await expect(reserveBudget(deps, reservation)).rejects.toThrow("db down");
    read.mockRestore();
    expect(await new AiUsageModel(db).listSince("2000-01-01T00:00:00.000Z")).toEqual([]);
  });
});

describe("recordUsage", () => {
  const usage = {
    insightId: "i1",
    ...reservation,
    inputTokens: 20,
    outputTokens: 10,
    estimated: false,
    images: 0,
    status: "ok" as const,
  };

  it("fills in the insight's reservation instead of adding a second row", async () => {
    const { db } = makeDatabase();
    const deps = depsWith(db);
    const id = await reserveBudget(deps, reservation);
    await new AiUsageModel(db).attach(id, "i1");
    await recordUsage(deps, usage);
    const rows = await new AiUsageModel(db).listSince("2000-01-01T00:00:00.000Z");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, status: "ok", inputTokens: 20, outputTokens: 10 });
  });

  it("adds a row when the insight had no reservation", async () => {
    const { db } = makeDatabase();
    await recordUsage(depsWith(db), usage);
    expect(await new AiUsageModel(db).listSince("2000-01-01T00:00:00.000Z")).toHaveLength(1);
  });
});
