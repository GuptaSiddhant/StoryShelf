import { describe, expect, it } from "vitest";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { AiUsageModel, type AiUsageInput } from "./ai-usage.ts";

const input = (over: Partial<AiUsageInput> = {}): AiUsageInput => ({
  insightId: null,
  projectId: "p1",
  profile: "default",
  task: "triage",
  model: "m",
  inputTokens: 10,
  outputTokens: 5,
  estimated: false,
  images: 0,
  status: "ok",
  ...over,
});

describe("AiUsageModel", () => {
  it("records, lists since a cutoff, and counts calls per project", async () => {
    const { db } = makeDatabase();
    const model = new AiUsageModel(db);
    await model.record(input());
    await model.record(input({ projectId: "p2" }));
    const since = new Date(Date.now() - 60_000).toISOString();
    expect(await model.listSince(since)).toHaveLength(2);
    expect(await model.countCalls("p1", since)).toBe(1);
    expect(await model.listSince(new Date(Date.now() + 60_000).toISOString())).toHaveLength(0);
  });

  it("pages through more rows than one page", async () => {
    const { db } = makeDatabase();
    const model = new AiUsageModel(db);
    await Promise.all(Array.from({ length: 510 }, () => model.record(input())));
    expect(await model.listSince("2000-01-01T00:00:00.000Z")).toHaveLength(510);
  });

  it("purges old rows", async () => {
    const { db } = makeDatabase();
    const model = new AiUsageModel(db);
    await model.record(input());
    expect(await model.purgeBefore(new Date(Date.now() + 60_000).toISOString())).toBe(1);
    expect(await model.listSince("2000-01-01T00:00:00.000Z")).toHaveLength(0);
  });
});
