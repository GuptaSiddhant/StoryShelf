import { describe, expect, it } from "vitest";
import { AiUsageModel } from "../models/ai-usage.ts";
import { InsightModel } from "../models/insight.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { purgeAiData } from "./ai.ts";

describe("purgeAiData", () => {
  it("removes old health digests and usage rows, and sweeps stale runs", async () => {
    const { db } = makeDatabase();
    const insights = new InsightModel(db);
    await insights.start({
      projectId: "p",
      buildId: null,
      kind: "health",
      windowKey: "30d",
      inputHash: "h",
      profile: "d",
      model: "m",
      promptVersion: "v1",
    });
    await new AiUsageModel(db).record({
      insightId: null,
      projectId: "p",
      profile: "d",
      task: "health",
      model: "m",
      inputTokens: 1,
      outputTokens: 1,
      estimated: false,
      images: 0,
      status: "ok",
    });
    const later = new Date(Date.now() + 500 * 86_400_000);
    expect(await purgeAiData(db, later)).toEqual({ health: 1, usage: 1, interrupted: 0 });
    expect(await purgeAiData(db)).toEqual({ health: 0, usage: 0, interrupted: 0 });
  });

  it("marks only runs older than the stale window as interrupted", async () => {
    const { db } = makeDatabase();
    await new InsightModel(db).start({
      projectId: "p",
      buildId: "b",
      kind: "triage",
      windowKey: null,
      inputHash: "h",
      profile: "d",
      model: "m",
      promptVersion: "v1",
    });
    expect((await purgeAiData(db)).interrupted).toBe(0);
    const soon = new Date(Date.now() + 31 * 60_000);
    expect((await purgeAiData(db, soon)).interrupted).toBe(1);
  });
});

describe("purgeAiData windows", () => {
  const usage = {
    insightId: null,
    projectId: "p",
    profile: "d",
    task: "health",
    model: "m",
    inputTokens: 1,
    outputTokens: 1,
    estimated: false,
    images: 0,
    status: "ok",
  } as const;

  it("keeps usage for 400 days and insights for 180 by default", async () => {
    const { db } = makeDatabase();
    await new AiUsageModel(db).record(usage);
    const day = 86_400_000;
    expect((await purgeAiData(db, new Date(Date.now() + 399 * day))).usage).toBe(0);
    expect((await purgeAiData(db, new Date(Date.now() + 401 * day))).usage).toBe(1);
  });

  it("honours configured windows and null keeps the rows", async () => {
    const { db } = makeDatabase();
    await new AiUsageModel(db).record(usage);
    const later = new Date(Date.now() + 10 * 86_400_000);
    const kept = await purgeAiData(db, later, undefined, { usageDays: null });
    expect(kept.usage).toBe(0);
    const gone = await purgeAiData(db, later, undefined, { usageDays: 5 });
    expect(gone.usage).toBe(1);
  });
});
