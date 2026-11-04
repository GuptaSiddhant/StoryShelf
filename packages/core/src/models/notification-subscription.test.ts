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

  it("starts with review requests on and keeps the choice across later saves", async () => {
    const { db } = makeDatabase();
    const first = await model(db).upsert("p1", "u1", { via: ["email"] });
    expect(first.reviewRequests).toBe(true);
    await model(db).setReviewRequests("p1", "u1", false);
    await model(db).upsert("p1", "u1", { events: ["build:approved"], via: ["email"] });
    const row = await model(db).getFor("p1", "u1");
    expect(row!.reviewRequests).toBe(false);
    expect(NotificationSubscriptionModel.eventsOf(row!)).toEqual(["build:approved"]);
    await model(db).upsert("p1", "u1", { via: ["email"], reviewRequests: true });
    expect((await model(db).getFor("p1", "u1"))!.reviewRequests).toBe(true);
  });

  it("records an opt-out for someone with no row without subscribing them, and undoes it", async () => {
    const { db } = makeDatabase();
    await model(db).setReviewRequests("p1", "u1", true);
    expect(await model(db).getFor("p1", "u1")).toBeNull();
    await model(db).setReviewRequests("p1", "u1", false);
    const row = await model(db).getFor("p1", "u1");
    expect(row).toMatchObject({ enabled: false, reviewRequests: false, events: null, via: null });
    await model(db).setReviewRequests("p1", "u1", true);
    expect(await model(db).getFor("p1", "u1")).toBeNull();
  });

  it("switches a subscription off and on without losing topics, channels or the review choice", async () => {
    const { db } = makeDatabase();
    await model(db).setEnabled("p1", "u1", false);
    expect(await model(db).getFor("p1", "u1")).toBeNull();
    await model(db).upsert("p1", "u1", {
      events: ["build:approved"],
      via: ["email"],
      reviewRequests: false,
    });
    await model(db).setEnabled("p1", "u1", false);
    let row = await model(db).getFor("p1", "u1");
    expect(row).toMatchObject({ enabled: false, reviewRequests: false });
    expect(NotificationSubscriptionModel.eventsOf(row!)).toEqual(["build:approved"]);
    await model(db).setEnabled("p1", "u1", true);
    row = await model(db).getFor("p1", "u1");
    expect(row).toMatchObject({ enabled: true, reviewRequests: false });
    expect(NotificationSubscriptionModel.viaOf(row!)).toEqual(["email"]);
  });

  it("keeps an email opt-out when review requests are switched on, off and on again", async () => {
    const { db } = makeDatabase();
    await model(db).upsert("p1", "u1", { enabled: false });
    await model(db).setReviewRequests("p1", "u1", true);
    expect(await model(db).getFor("p1", "u1")).toMatchObject({ enabled: false });
    await model(db).setReviewRequests("p1", "u1", false);
    await model(db).setReviewRequests("p1", "u1", true);
    expect(await model(db).getFor("p1", "u1")).toBeNull();
  });

  it("keeps a subscription that has topics when review requests come back on", async () => {
    const { db } = makeDatabase();
    await model(db).upsert("p1", "u1", { events: ["build:approved"], enabled: false });
    await model(db).setReviewRequests("p1", "u1", false);
    await model(db).setReviewRequests("p1", "u1", true);
    expect(await model(db).getFor("p1", "u1")).toMatchObject({
      enabled: false,
      reviewRequests: true,
    });
  });

  it("adds review:requested to a topic list that left it out when the switch comes on", async () => {
    const { db } = makeDatabase();
    await model(db).upsert("p1", "u1", {
      events: ["build:approved"],
      via: ["email"],
      enabled: false,
    });
    await model(db).setReviewRequests("p1", "u1", false);
    await model(db).setReviewRequests("p1", "u1", true);
    const row = await model(db).getFor("p1", "u1");
    expect(NotificationSubscriptionModel.eventsOf(row!)).toEqual([
      "build:approved",
      "review:requested",
    ]);
    expect(row).toMatchObject({ enabled: false, reviewRequests: true });
    await model(db).setReviewRequests("p1", "u1", true);
    expect(NotificationSubscriptionModel.eventsOf((await model(db).getFor("p1", "u1"))!)).toEqual([
      "build:approved",
      "review:requested",
    ]);
  });

  it("does not write the review switch when a plain save does not give it", async () => {
    const { db } = makeDatabase();
    await model(db).upsert("p1", "u1", { via: ["email"], reviewRequests: false });
    const update = db.update.bind(db);
    const seen: Record<string, unknown>[] = [];
    db.update = (async (...args: Parameters<typeof db.update>) => {
      seen.push(args[2] as Record<string, unknown>);
      return await update(...args);
    }) as typeof db.update;
    await model(db).upsert("p1", "u1", { events: ["build:approved"], via: ["email"] });
    expect(seen[0]).not.toHaveProperty("reviewRequests");
    expect((await model(db).getFor("p1", "u1"))!.reviewRequests).toBe(false);
  });
});
