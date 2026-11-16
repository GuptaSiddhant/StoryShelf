import { lt, asc } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AiUsageModel } from "../models/ai-usage.ts";
import { col } from "../models/columns.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { deleteInBatches } from "./batched-delete.ts";

async function seed(db: ReturnType<typeof makeDatabase>["db"], count: number) {
  const model = new AiUsageModel(db);
  for (let index = 0; index < count; index += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- sequential seeding
    await model.record({
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
  }
}

describe("deleteInBatches", () => {
  it("removes every matching row across several batches", async () => {
    const { db } = makeDatabase();
    await seed(db, 7);
    const table = db.tables.aiUsage;
    const where = lt(col(table, "createdAt"), "9999-01-01");
    expect(await deleteInBatches(db, table, where, asc(col(table, "id")), 3)).toBe(7);
    expect(await db.count(table)).toBe(0);
  });

  it("stops at the batch cap and leaves the rest for the next pass", async () => {
    const { db } = makeDatabase();
    await seed(db, 7);
    const table = db.tables.aiUsage;
    const where = lt(col(table, "createdAt"), "9999-01-01");
    expect(await deleteInBatches(db, table, where, asc(col(table, "id")), 3, 2)).toBe(6);
    expect(await db.count(table)).toBe(1);
  });
});
