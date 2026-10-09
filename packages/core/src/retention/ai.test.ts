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
    const later = new Date(Date.now() + 100 * 86_400_000);
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
