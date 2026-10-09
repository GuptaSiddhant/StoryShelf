import { describe, expect, it } from "vitest";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { AiBudgetAlertModel } from "./ai-budget-alert.ts";

describe("AiBudgetAlertModel", () => {
  it("lets exactly one claimant win per (day, threshold)", async () => {
    const { db } = makeDatabase();
    const model = new AiBudgetAlertModel(db);
    expect(await model.claim("2026-10-08", 50)).toBe(true);
    expect(await model.claim("2026-10-08", 50)).toBe(false);
    expect(await model.claim("2026-10-08", 75)).toBe(true);
    expect(await model.claim("2026-10-09", 50)).toBe(true);
    expect(await model.listForDay("2026-10-08")).toHaveLength(2);
  });
});
