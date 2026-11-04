import { describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { makeDatabase } from "../test-helpers/index.ts";
import { ContentCollectingError, recordContentUses } from "./content-uses.ts";

const target = { projectId: "p", buildId: "b" };

function withLifecycle(refused: string[]) {
  const { db } = makeDatabase();
  const record = vi.fn(async () => await Promise.resolve(refused));
  Object.assign(db, { buildReferenceLifecycle: { recordContentUses: record } });
  return { db: db as DatabaseAdapter, record };
}

describe("recordContentUses", () => {
  it("records nothing without the lifecycle capability", async () => {
    const { db } = makeDatabase();
    await expect(recordContentUses(db, target, ["h1"])).resolves.toBeUndefined();
    await expect(recordContentUses(undefined, target, ["h1"])).resolves.toBeUndefined();
  });

  it("passes each distinct hash once, and skips the call for none", async () => {
    const { db, record } = withLifecycle([]);
    await recordContentUses(db, target, ["h1", "h2", "h1"]);
    expect(record).toHaveBeenCalledWith("p", "b", ["h1", "h2"]);

    record.mockClear();
    await recordContentUses(db, target, []);
    expect(record).not.toHaveBeenCalled();
  });

  it("throws for the hashes a collector claimed, so the caller retries", async () => {
    const { db } = withLifecycle(["h2"]);
    const error = await recordContentUses(db, target, ["h1", "h2"]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ContentCollectingError);
    expect((error as ContentCollectingError).hashes).toEqual(["h2"]);
    expect((error as Error).message).toContain("h2");
  });
});
