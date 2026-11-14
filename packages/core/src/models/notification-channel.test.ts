import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { NotifierProvider } from "../adapters/notifier/index.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { overrideOutboundResolver } from "../utils/outbound.ts";
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

  it("validates channel input against the notifier schema", async () => {
    const email = {
      metadata: { kind: "email", schema: z.object({ to: z.string() }) },
    } as unknown as NotifierProvider;
    expect(await NotificationChannelModel.validateInput([email], "email", { to: "a@b.c" })).toEqual(
      {
        ok: true,
      },
    );
    expect(await NotificationChannelModel.validateInput([email], "slack", {})).toMatchObject({
      ok: false,
      field: "provider",
    });
    expect(await NotificationChannelModel.validateInput([email], "email", {})).toMatchObject({
      ok: false,
      field: "config",
    });
  });

  it("requires a project and a token for state (git) providers", async () => {
    const git = {
      metadata: { kind: "github", delivery: "state", schema: z.object({ owner: z.string() }) },
    } as unknown as NotifierProvider;
    const config = { owner: "acme" };
    expect(
      await NotificationChannelModel.validateInput([git], "github", config, {
        projectId: "p1",
        hasSecret: true,
      }),
    ).toEqual({ ok: true });
    expect(
      await NotificationChannelModel.validateInput([git], "github", config, {
        projectId: null,
        hasSecret: true,
      }),
    ).toMatchObject({ ok: false, field: "provider" });
    expect(
      await NotificationChannelModel.validateInput([git], "github", config, {
        projectId: "p1",
        hasSecret: false,
      }),
    ).toMatchObject({ ok: false, field: "secret" });
    expect(NotificationChannelModel.isStateKind([git], "github")).toBe(true);
    expect(NotificationChannelModel.isStateKind([git], "slack")).toBe(false);
  });

  it("refuses private or local chat and GitLab destinations when saved", async () => {
    const kinds = ["slack", "teams", "gitlab"].map(
      (kind) =>
        ({
          metadata: { kind, schema: z.object({ host: z.string().optional() }) },
        }) as unknown as NotifierProvider,
    );
    const restore = overrideOutboundResolver(async (name) => [
      { address: name === "internal.example" ? "10.0.0.5" : "93.184.216.34", family: 4 },
    ]);
    try {
      const urls = [
        "https://127.0.0.1/h",
        "https://169.254.169.254/h",
        "https://internal.example/h",
      ];
      const slack = await Promise.all(
        urls.map((url) =>
          NotificationChannelModel.validateInput(kinds, "slack", {}, undefined, url),
        ),
      );
      const gitlab = await Promise.all(
        urls.map((host) => NotificationChannelModel.validateInput(kinds, "gitlab", { host })),
      );
      for (const result of slack) {
        expect(result).toMatchObject({ ok: false, field: "secret" });
        expect(JSON.stringify(result)).not.toMatch(/10\.0\.0\.5|169\.254/u);
      }
      for (const result of gitlab) {
        expect(result).toMatchObject({ ok: false, field: "config", issues: [{ path: "host" }] });
      }
      expect(
        await NotificationChannelModel.validateInput(
          kinds,
          "teams",
          {},
          undefined,
          "https://hooks.example/x",
        ),
      ).toEqual({ ok: true });
      expect(await NotificationChannelModel.validateInput(kinds, "gitlab", {})).toEqual({
        ok: true,
      });
    } finally {
      restore();
    }
  });

  it("refuses a private GitHub Enterprise API base and names the operator setting", async () => {
    const kinds = [
      { metadata: { kind: "github", schema: z.object({ apiUrl: z.string().optional() }) } },
    ] as unknown as NotifierProvider[];
    const restore = overrideOutboundResolver(async () => [{ address: "10.0.0.5", family: 4 }]);
    try {
      const result = await NotificationChannelModel.validateInput(kinds, "github", {
        apiUrl: "https://ghes.internal/api/v3",
      });
      expect(result).toMatchObject({ ok: false, field: "config", issues: [{ path: "apiUrl" }] });
      expect(JSON.stringify(result)).toContain("outbound.allowHosts");
      expect(JSON.stringify(result)).not.toContain("10.0.0.5");
      expect(await NotificationChannelModel.validateInput(kinds, "github", {})).toEqual({
        ok: true,
      });
    } finally {
      restore();
    }
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

  it("writes nothing for an outcome whose attempt was abandoned", async () => {
    const { db } = makeDatabase();
    const created = await model(db).create({ projectId: "p1", provider: "log", config: {} });
    const controller = new AbortController();
    controller.abort(new Error("job deadline exceeded"));

    await expect(model(db).recordOutcome(created.id, "boom", controller.signal)).rejects.toThrow(
      "job deadline exceeded",
    );

    expect((await model(db).get(created.id))?.lastError).toBeNull();
  });

  it("writes nothing when the attempt is abandoned while the channel is being looked up", async () => {
    const { db } = makeDatabase();
    const created = await model(db).create({ projectId: "p1", provider: "log", config: {} });
    const controller = new AbortController();
    const list = db.list.bind(db);
    db.list = async (...args) => {
      const rows = await list(...args);
      controller.abort(new Error("job deadline exceeded"));
      return rows;
    };

    await expect(model(db).recordOutcome(created.id, "boom", controller.signal)).rejects.toThrow(
      "job deadline exceeded",
    );

    db.list = list;
    expect((await model(db).get(created.id))?.lastError).toBeNull();
  });

  it("stamps the last delivery on success and leaves it alone on failure", async () => {
    const { db } = makeDatabase();
    const created = await model(db).create({ projectId: "p1", provider: "log", config: {} });
    expect(created.lastDeliveredAt).toBeNull();

    await model(db).recordOutcome(created.id);
    const delivered = (await model(db).get(created.id))?.lastDeliveredAt;
    expect(delivered).toEqual(expect.any(String));

    await model(db).recordOutcome(created.id, "HTTP 502");
    const failed = await model(db).get(created.id);
    expect(failed?.lastDeliveredAt).toBe(delivered);
    expect(failed?.lastError).toBe("HTTP 502");
  });

  it("skips the write when a clean channel reports success", async () => {
    const { db } = makeDatabase();
    const created = await model(db).create({ projectId: "p1", provider: "log", config: {} });
    await model(db).recordOutcome(created.id);
    await model(db).recordOutcome("missing", "boom");
    expect((await model(db).get(created.id))?.updatedAt).toBe(created.updatedAt);
  });
});
