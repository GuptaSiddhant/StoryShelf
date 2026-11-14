/**
 * Row-level contract for `PushSubscriptionModel` against a real dialect: replace by endpoint, list
 * by user, delete, the success and failure counters, and removal with the owning user.
 */
import { describe, expect, it } from "vitest";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { PushSubscriptionModel } from "../models/push-subscription.ts";
import { ulid } from "../utils/ulid.ts";
import type { DatabaseFactory } from "./database-contract.ts";

async function addUser(db: DatabaseAdapter, email: string): Promise<string> {
  const id = ulid();
  await db.insert(db.tables.users, {
    id,
    email,
    name: email,
    role: "member",
    createdAt: new Date().toISOString(),
    authProvider: "local",
    disabled: false,
  } as never);
  return id;
}

const keys = { p256dh: "BKey", auth: "secret" };

async function setupFor(make: DatabaseFactory) {
  const db = await make();
  await db.lifecycle?.setup({ config: {} as never, logger: undefined as never });
  return { db, model: new PushSubscriptionModel(db), userId: await addUser(db, "a@x.test") };
}

/** Run the push subscription model against a factory (one fresh adapter per case). */
export function pushSubscriptionContractSuite(label: string, make: DatabaseFactory): void {
  describe(`push subscriptions: ${label}`, () => {
    it("adds a device, lists it for its user and replaces it by endpoint", async () => {
      const { db, model, userId } = await setupFor(make);
      const other = await addUser(db, "b@x.test");
      const first = await model.add(userId, { endpoint: "https://push.test/1", ...keys });
      expect(first).toMatchObject({ userId, label: null, lastSuccessAt: null, failureCount: 0 });
      await model.recordFailure(first.id);
      const again = await model.add(other, {
        endpoint: "https://push.test/1",
        p256dh: "BNew",
        auth: "newer",
        label: "Phone",
      });
      expect(again).toMatchObject({
        id: first.id,
        userId: other,
        p256dh: "BNew",
        label: "Phone",
        failureCount: 0,
      });
      expect(await model.listForUser(userId)).toEqual([]);
      expect(await model.listForUser(other)).toHaveLength(1);
      expect((await model.findByEndpoint("https://push.test/1"))?.id).toBe(first.id);
      expect(await model.findByEndpoint("https://push.test/none")).toBeNull();
    });

    it("keeps endpoints unique when two registrations race", async () => {
      const { model, userId } = await setupFor(make);
      const input = { endpoint: "https://push.test/race", ...keys };
      await Promise.all([model.add(userId, input), model.add(userId, input)]);
      expect(await model.listForUser(userId)).toHaveLength(1);
    });

    it("counts failures, resets them on success and stamps the time", async () => {
      const { model, userId } = await setupFor(make);
      const row = await model.add(userId, { endpoint: "https://push.test/2", ...keys });
      expect(await model.recordFailure(row.id)).toBe(1);
      expect(await model.recordFailure(row.id)).toBe(2);
      const at = new Date("2026-11-14T10:00:00.000Z");
      await model.recordSuccess(row.id, at);
      const [stored] = await model.listForUser(userId);
      expect(stored?.failureCount).toBe(0);
      expect(new Date(stored?.lastSuccessAt ?? "").toISOString()).toBe(at.toISOString());
      expect(await model.recordFailure("missing")).toBe(0);
    });

    it("deletes a device, only for its owner when asked by user", async () => {
      const { db, model, userId } = await setupFor(make);
      const other = await addUser(db, "c@x.test");
      const mine = await model.add(userId, { endpoint: "https://push.test/3", ...keys });
      const theirs = await model.add(other, { endpoint: "https://push.test/4", ...keys });
      expect(await model.removeOwned(userId, theirs.id)).toBe(false);
      expect(await model.removeOwned(userId, mine.id)).toBe(true);
      expect(await model.removeOwned(userId, mine.id)).toBe(false);
      await model.remove(theirs.id);
      expect(await model.listForUser(other)).toEqual([]);
    });

    it("deletes its devices with the user", async () => {
      const { db, model, userId } = await setupFor(make);
      await model.add(userId, { endpoint: "https://push.test/5", ...keys });
      await db.remove(db.tables.users, userId);
      expect(await model.findByEndpoint("https://push.test/5")).toBeNull();
    });
  });
}
