import { describe, expect, it } from "vitest";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { NotificationSubscriptionModel } from "./notification-subscription.ts";

function model(db: ReturnType<typeof makeDatabase>["db"]): NotificationSubscriptionModel {
  return new NotificationSubscriptionModel(db, {
    notificationSubscriptions: db.tables.notificationSubscriptions,
  });
}

describe("NotificationSubscriptionModel", () => {
  it("returns null when the user never opted in", async () => {
    const { db } = makeDatabase();
    expect(await model(db).getFor("p1", "u1")).toBeNull();
  });

  it("upserts then reads back events and via", async () => {
    const { db } = makeDatabase();
    await model(db).upsert("p1", "u1", { events: ["build:reviewing"], via: ["email"] });
    const row = await model(db).getFor("p1", "u1");
    expect(row).not.toBeNull();
    expect(NotificationSubscriptionModel.eventsOf(row!)).toEqual(["build:reviewing"]);
    expect(NotificationSubscriptionModel.viaOf(row!)).toEqual(["email"]);
    await model(db).upsert("p1", "u1", { events: [], via: ["email"], enabled: false });
    const updated = await model(db).getFor("p1", "u1");
    expect(NotificationSubscriptionModel.eventsOf(updated!)).toEqual([]);
    expect(updated!.enabled).toBe(false);
  });

  it("scopes rows per project and removes on opt-out", async () => {
    const { db } = makeDatabase();
    await model(db).upsert("p1", "u1", { via: ["email"] });
    await model(db).upsert("p2", "u1", { via: ["email"] });
    expect(await model(db).list("p1")).toHaveLength(1);
    await model(db).remove("p1", "u1");
    expect(await model(db).getFor("p1", "u1")).toBeNull();
    expect(await model(db).getFor("p2", "u1")).not.toBeNull();
  });

  it("lists all subscriptions for a user", async () => {
    const { db } = makeDatabase();
    await model(db).upsert("p1", "u1", { via: ["email"] });
    await model(db).upsert("p2", "u1", { via: ["email"] });
    await model(db).upsert("p1", "u2", { via: ["email"] });
    const rows = await model(db).listForUser("u1");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.projectId)).toContain("p1");
    expect(rows.map((row) => row.projectId)).toContain("p2");
  });
});
