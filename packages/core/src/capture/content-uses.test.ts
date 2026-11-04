import { describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { makeDatabase, makeStorage } from "../test-helpers/index.ts";
import { ContentCollectingError, recordContentUses } from "./content-uses.ts";

const target = { projectId: "p", buildId: "b" };

/** Storage holding the blobs of the given hashes. */
function storageWith(...hashes: string[]) {
  const { storage, objects } = makeStorage();
  for (const hash of hashes) objects.set(`content/${hash}`, Buffer.from(hash));
  return storage;
}

function withLifecycle(refused: string[]) {
  const { db } = makeDatabase();
  const record = vi.fn(async () => await Promise.resolve(refused));
  Object.assign(db, { buildReferenceLifecycle: { recordContentUses: record } });
  return { db: db as DatabaseAdapter, record };
}

describe("recordContentUses", () => {
  it("records nothing without the lifecycle capability", async () => {
    const { db } = makeDatabase();
    await expect(recordContentUses(db, storageWith(), target, ["h1"])).resolves.toBeUndefined();
    await expect(
      recordContentUses(undefined, storageWith(), target, ["h1"]),
    ).resolves.toBeUndefined();
  });

  it("passes each distinct hash once, and skips the call for none", async () => {
    const { db, record } = withLifecycle([]);
    await recordContentUses(db, storageWith("h1", "h2"), target, ["h1", "h2", "h1"]);
    expect(record).toHaveBeenCalledWith("p", "b", ["h1", "h2"]);

    record.mockClear();
    await recordContentUses(db, storageWith(), target, []);
    expect(record).not.toHaveBeenCalled();
  });

  it("throws for the hashes a collector claimed, so the caller retries", async () => {
    const { db } = withLifecycle(["h2"]);
    const error = await recordContentUses(db, storageWith("h1", "h2"), target, ["h1", "h2"]).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ContentCollectingError);
    expect((error as ContentCollectingError).hashes).toEqual(["h2"]);
    expect((error as Error).message).toContain("h2");
  });

  it("fails for a recorded hash whose blob was collected meanwhile, so the caller stores it again", async () => {
    const { db, record } = withLifecycle([]);
    const error = await recordContentUses(db, storageWith("h1"), target, ["h1", "h2"]).catch(
      (e: unknown) => e,
    );
    expect(record).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(ContentCollectingError);
    expect((error as ContentCollectingError).hashes).toEqual(["h2"]);
  });
});
