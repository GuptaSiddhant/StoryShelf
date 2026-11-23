import { describe, expect, it } from "vitest";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { PushSubscriptionModel } from "./push-subscription.ts";

const keys = { p256dh: "BKey", auth: "secret" };

function model(): PushSubscriptionModel {
  return new PushSubscriptionModel(makeDatabase().db);
}

describe("PushSubscriptionModel", () => {
  it("adds a device and replaces it when the endpoint comes back", async () => {
    const m = model();
    const first = await m.add("u1", { endpoint: "https://push.test/1", ...keys });
    expect(first).toMatchObject({ userId: "u1", label: null, failureCount: 0 });
    const again = await m.add("u2", { endpoint: "https://push.test/1", ...keys, label: "Laptop" });
    expect(again).toMatchObject({ id: first.id, userId: "u2", label: "Laptop" });
    expect(await m.listForUser("u1")).toEqual([]);
    expect(await m.listForUser("u2")).toHaveLength(1);
  });

  it("falls back to replacing the winner when the insert loses the unique index", async () => {
    const { db } = makeDatabase();
    const m = new PushSubscriptionModel(db);
    const real = db.insert.bind(db);
    let first = true;
    db.insert = (async (table: never, values: never) => {
      if (first) {
        first = false;
        await real(table, { ...(values as object), id: "winner" } as never);
        throw new Error("UNIQUE constraint failed");
      }
      return await real(table, values);
    }) as typeof db.insert;
    const row = await m.add("u1", { endpoint: "https://push.test/r", ...keys });
    expect(row.id).toBe("winner");
  });

  it("rethrows an insert failure that is not a lost race", async () => {
    const { db } = makeDatabase();
    db.insert = (() => Promise.reject(new Error("disk full"))) as typeof db.insert;
    await expect(
      new PushSubscriptionModel(db).add("u1", { endpoint: "https://push.test/x", ...keys }),
    ).rejects.toThrow("disk full");
  });

  it("counts failures, resets on success and ignores a missing id", async () => {
    const m = model();
    const row = await m.add("u1", { endpoint: "https://push.test/2", ...keys });
    expect(await m.recordFailure(row.id)).toBe(1);
    expect(await m.recordFailure(row.id)).toBe(2);
    await m.recordSuccess(row.id, new Date("2026-11-14T10:00:00.000Z"));
    expect(await m.listForUser("u1")).toMatchObject([
      { failureCount: 0, lastSuccessAt: "2026-11-14T10:00:00.000Z" },
    ]);
    expect(await m.recordFailure("missing")).toBe(0);
  });

  it("gives up on a failure counter that keeps losing the race", async () => {
    const m = model();
    const row = await m.add("u1", { endpoint: "https://push.test/c", ...keys });
    await expect(m.recordFailure(row.id, 0)).rejects.toThrow("contended");
  });

  it("removes only the caller's own device by user", async () => {
    const m = model();
    const mine = await m.add("u1", { endpoint: "https://push.test/3", ...keys });
    const theirs = await m.add("u2", { endpoint: "https://push.test/4", ...keys });
    expect(await m.removeOwned("u1", theirs.id)).toBe(false);
    expect(await m.removeOwned("u1", mine.id)).toBe(true);
    await m.remove(theirs.id);
    expect(await m.findByEndpoint("https://push.test/4")).toBeNull();
  });
});
