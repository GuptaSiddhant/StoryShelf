import { PushSubscriptionModel } from "@storyshelf/core/models";
import { makeDatabase } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { runWithStore, type Store } from "../store.ts";
import { forgetPushDevice } from "./push.ts";

const ENDPOINT = "https://push.example.net/p/abc";

async function seed() {
  const { db } = makeDatabase();
  const devices = new PushSubscriptionModel(db);
  await devices.add("u1", { endpoint: ENDPOINT, p256dh: "k", auth: "a" });
  return { db, devices };
}

function asUser(db: Store["db"], userId: string | null, fn: () => Promise<void>): Promise<void> {
  const store = {
    db,
    logger: pino({ level: "silent" }),
    user: userId === null ? null : { id: userId },
  } as unknown as Store;
  return runWithStore(store, fn);
}

describe("forgetPushDevice (sign-out)", () => {
  it("deletes the signed-in user's own device", async () => {
    const { db, devices } = await seed();
    await asUser(db, "u1", async () => await forgetPushDevice(ENDPOINT));
    expect(await devices.findByEndpoint(ENDPOINT)).toBeNull();
  });

  it("leaves another person's device, and does nothing without a session or endpoint", async () => {
    const { db, devices } = await seed();
    await asUser(db, "u2", async () => await forgetPushDevice(ENDPOINT));
    await asUser(db, null, async () => await forgetPushDevice(ENDPOINT));
    await asUser(db, "u1", async () => await forgetPushDevice());
    await asUser(db, "u1", async () => await forgetPushDevice(`${ENDPOINT}${"x".repeat(600)}`));
    expect(await devices.findByEndpoint(ENDPOINT)).not.toBeNull();
  });

  it("never throws", async () => {
    const { db } = await seed();
    const broken = { ...db, list: () => Promise.reject(new Error("db down")) } as Store["db"];
    await expect(
      asUser(broken, "u1", async () => await forgetPushDevice(ENDPOINT)),
    ).resolves.toBeUndefined();
  });
});
