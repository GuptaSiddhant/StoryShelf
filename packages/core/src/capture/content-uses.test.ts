import { describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { Logger } from "../logger.ts";
import { makeDatabase, makeStorage } from "../test-helpers/index.ts";
import { contentKey } from "../utils/paths.ts";
import { ContentCollectingError, recordContentUses } from "./content-uses.ts";

const target = { projectId: "p", buildId: "b" };
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);

/** Storage holding the blobs of the given hashes. */
function storageWith(...hashes: string[]) {
  const { storage, objects } = makeStorage();
  for (const hash of hashes) objects.set(contentKey(hash), Buffer.from(hash));
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
    await expect(recordContentUses(db, storageWith(), target, [H1])).resolves.toBe(0);
    await expect(recordContentUses(undefined, storageWith(), target, [H1])).resolves.toBe(0);
  });

  it("passes each distinct hash once, and skips the call for none", async () => {
    const { db, record } = withLifecycle([]);
    await recordContentUses(db, storageWith(H1, H2), target, [H1, H2, H1]);
    expect(record).toHaveBeenCalledWith("p", "b", [H1, H2]);

    record.mockClear();
    await recordContentUses(db, storageWith(), target, []);
    expect(record).not.toHaveBeenCalled();
  });

  it("throws for the hashes a collector claimed, so the caller retries", async () => {
    const { db } = withLifecycle([H2]);
    const error = await recordContentUses(db, storageWith(H1, H2), target, [H1, H2]).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ContentCollectingError);
    expect((error as ContentCollectingError).hashes).toEqual([H2]);
    expect((error as Error).message).toContain(H2);
  });

  it("fails for a recorded hash whose blob was collected meanwhile, so the caller stores it again", async () => {
    const { db, record } = withLifecycle([]);
    const error = await recordContentUses(db, storageWith(H1), target, [H1, H2]).catch(
      (e: unknown) => e,
    );
    expect(record).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(ContentCollectingError);
    expect((error as ContentCollectingError).hashes).toEqual([H2]);
  });

  it("never records or looks up a value that is not a content hash, and logs it once without it", async () => {
    const { db, record } = withLifecycle([]);
    const storage = storageWith(H1);
    const exists = vi.spyOn(storage, "exists");
    const warn = vi.fn();
    const logger = { warn } as unknown as Logger;
    const evil = "../p/builds/b/storybook/index.html";

    const skipped = await recordContentUses(db, storage, target, [evil, H1, "", evil], logger);

    expect(skipped).toBe(2);
    expect(record).toHaveBeenCalledWith("p", "b", [H1]);
    expect(exists).toHaveBeenCalledTimes(1);
    expect(exists).toHaveBeenCalledWith(contentKey(H1));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(evil);
  });

  it("records nothing when every value is malformed", async () => {
    const { db, record } = withLifecycle([]);
    await expect(recordContentUses(db, storageWith(), target, ["../x"])).resolves.toBe(1);
    expect(record).not.toHaveBeenCalled();
  });
});
