import { describe, expect, it } from "vitest";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { NotificationChannelModel } from "./notification-channel.ts";

const TEST_SECRET = "test-server-secret-32-chars-long!!";

function model(db: ReturnType<typeof makeDatabase>["db"]): NotificationChannelModel {
  return new NotificationChannelModel(
    db,
    { notificationChannels: db.tables.notificationChannels },
    TEST_SECRET,
  );
}

describe("NotificationChannelModel", () => {
  it("creates a project channel with encrypted secret and event filter", async () => {
    const { db } = makeDatabase();
    const channel = await model(db).create({
      projectId: "p1",
      provider: "slack-webhook",
      config: { style: "compact" },
      secret: "https://hooks.slack.com/x",
      events: ["build:reviewing"],
    });
    expect(channel.id).toBeDefined();
    expect(channel.projectId).toBe("p1");
    expect(channel.secretEncrypted).not.toContain("hooks.slack.com");
    expect(NotificationChannelModel.eventsOf(channel)).toEqual(["build:reviewing"]);
    expect(NotificationChannelModel.configOf(channel)).toEqual({ style: "compact" });
  });

  it("creates secret-less channels (e.g. log provider)", async () => {
    const { db } = makeDatabase();
    const channel = await model(db).create({
      projectId: "p1",
      provider: "log",
      config: {},
    });
    expect(channel.secretEncrypted).toBeNull();
    expect(NotificationChannelModel.eventsOf(channel)).toEqual([]);
  });

  it("lists project channels separately from system channels", async () => {
    const { db } = makeDatabase();
    await model(db).create({ projectId: "p1", provider: "log", config: {} });
    await model(db).create({ projectId: null, provider: "email", config: {} });
    expect(await model(db).list("p1")).toHaveLength(1);
    expect(await model(db).listSystem()).toHaveLength(1);
  });

  it("round-trips the secret and removes by id", async () => {
    const { db } = makeDatabase();
    const created = await model(db).create({
      projectId: "p1",
      provider: "slack-webhook",
      config: {},
      secret: "shh",
    });
    expect(model(db).decryptSecret(created)).toBe("shh");
    await model(db).remove(created.id);
    expect(await model(db).get(created.id)).toBeNull();
  });
});
