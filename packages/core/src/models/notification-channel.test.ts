import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { NotifierProvider } from "../adapters/notifier/index.ts";
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

  it("validates channel input against the notifier schema", () => {
    const email = {
      metadata: { kind: "email", schema: z.object({ to: z.string() }) },
    } as unknown as NotifierProvider;
    expect(NotificationChannelModel.validateInput([email], "email", { to: "a@b.c" })).toEqual({
      ok: true,
    });
    expect(NotificationChannelModel.validateInput([email], "slack", {})).toMatchObject({
      ok: false,
      field: "provider",
    });
    expect(NotificationChannelModel.validateInput([email], "email", {})).toMatchObject({
      ok: false,
      field: "config",
    });
  });

  it("requires a project and a token for state (git) providers", () => {
    const git = {
      metadata: { kind: "github", delivery: "state", schema: z.object({ owner: z.string() }) },
    } as unknown as NotifierProvider;
    const config = { owner: "acme" };
    expect(
      NotificationChannelModel.validateInput([git], "github", config, {
        projectId: "p1",
        hasSecret: true,
      }),
    ).toEqual({ ok: true });
    expect(
      NotificationChannelModel.validateInput([git], "github", config, {
        projectId: null,
        hasSecret: true,
      }),
    ).toMatchObject({ ok: false, field: "provider" });
    expect(
      NotificationChannelModel.validateInput([git], "github", config, {
        projectId: "p1",
        hasSecret: false,
      }),
    ).toMatchObject({ ok: false, field: "secret" });
    expect(NotificationChannelModel.isStateKind([git], "github")).toBe(true);
    expect(NotificationChannelModel.isStateKind([git], "slack")).toBe(false);
  });

  it("records the last delivery error with its time and clears it on success", async () => {
    const { db } = makeDatabase();
    const created = await model(db).create({ projectId: "p1", provider: "log", config: {} });
    expect(created.lastError).toBeNull();

    await model(db).recordOutcome(created.id, "HTTP 401: Bad credentials");
    const failed = await model(db).get(created.id);
    expect(failed?.lastError).toBe("HTTP 401: Bad credentials");
    expect(failed?.lastErrorAt).not.toBeNull();

    await model(db).recordOutcome(created.id);
    const cleared = await model(db).get(created.id);
    expect(cleared?.lastError).toBeNull();
    expect(cleared?.lastErrorAt).toBeNull();
  });

  it("skips the write when a clean channel reports success", async () => {
    const { db } = makeDatabase();
    const created = await model(db).create({ projectId: "p1", provider: "log", config: {} });
    await model(db).recordOutcome(created.id);
    await model(db).recordOutcome("missing", "boom");
    expect((await model(db).get(created.id))?.updatedAt).toBe(created.updatedAt);
  });
});
