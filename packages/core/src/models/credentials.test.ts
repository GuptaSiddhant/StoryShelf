import { describe, expect, it } from "vitest";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { encrypt } from "../utils/encrypt.ts";
import { probeCredentials, reencryptCredentials } from "./credentials.ts";
import { NotificationChannelModel } from "./notification-channel.ts";
import { StatusConfigModel } from "./status-config.ts";
import { WebhookModel } from "./webhook.ts";

const OLD = "old-secret";
const NEW = "new-secret";
const KEYS = { current: NEW, previous: OLD };

async function seedUnderOld() {
  const { db } = makeDatabase();
  const webhook = await new WebhookModel(db, undefined, OLD).create("p1", {
    url: "https://example.com/hook",
    secret: "whsec_1",
    events: [],
  });
  const status = await new StatusConfigModel(db, undefined, OLD).create("p1", {
    provider: "github",
    config: { owner: "o", repo: "r" },
    token: "ghp_token",
  });
  const channel = await new NotificationChannelModel(db, undefined, OLD).create({
    projectId: "p1",
    provider: "slack",
    config: {},
    secret: "hook-secret",
  });
  return { db, webhook, status, channel };
}

describe("probeCredentials", () => {
  it("counts rows that need the previous key", async () => {
    const { db } = await seedUnderOld();
    const probe = await probeCredentials(db, KEYS);
    expect(probe).toEqual({ total: 3, current: 0, previous: 3, unreadable: [] });
  });

  it("reports rows no key can decrypt without their values", async () => {
    const { db } = await seedUnderOld();
    await new WebhookModel(db, undefined, "unrelated").create("p1", {
      url: "https://example.com/other",
      secret: "whsec_2",
      events: [],
    });
    const probe = await probeCredentials(db, KEYS);
    expect(probe.unreadable).toHaveLength(1);
    expect(probe.unreadable[0]?.source).toBe("webhooks");
    expect(JSON.stringify(probe)).not.toContain("whsec_2");
  });

  it("skips channels without a secret", async () => {
    const { db } = makeDatabase();
    await new NotificationChannelModel(db, undefined, NEW).create({
      projectId: "p1",
      provider: "slack",
      config: {},
    });
    expect((await probeCredentials(db, KEYS)).total).toBe(0);
  });
});

describe("reencryptCredentials", () => {
  it("moves every table to the current key so the new secret alone works", async () => {
    const { db, webhook, status, channel } = await seedUnderOld();

    const result = await reencryptCredentials(db, KEYS);

    expect(result).toEqual({ reencrypted: 3, failed: 0, unreadable: [] });
    const onlyNew = NEW;
    const webhookRow = await new WebhookModel(db, undefined, onlyNew).get("p1", webhook.id);
    expect(new WebhookModel(db, undefined, onlyNew).decryptSecret(webhookRow!)).toBe("whsec_1");
    const [statusRow] = await new StatusConfigModel(db, undefined, onlyNew).list("p1");
    expect(new StatusConfigModel(db, undefined, onlyNew).decryptToken(statusRow!)).toBe(
      "ghp_token",
    );
    const channelModel = new NotificationChannelModel(db, undefined, onlyNew);
    const [channelRow] = await channelModel.list("p1");
    expect(channelModel.decryptSecret(channelRow!)).toBe("hook-secret");
    expect(status.id).toBe(statusRow?.id);
    expect(channel.id).toBe(channelRow?.id);
  });

  it("is idempotent", async () => {
    const { db } = await seedUnderOld();
    await reencryptCredentials(db, KEYS);
    expect(await reencryptCredentials(db, KEYS)).toEqual({
      reencrypted: 0,
      failed: 0,
      unreadable: [],
    });
    expect((await probeCredentials(db, KEYS)).current).toBe(3);
  });

  it("leaves unreadable rows untouched and reports them", async () => {
    const { db } = makeDatabase();
    const stranger = encrypt("unrelated", "whsec_x");
    await db.insert(db.tables.webhooks, {
      id: "w1",
      projectId: "p1",
      url: "https://example.com",
      secretEncrypted: stranger,
      events: "[]",
      createdAt: "2026-01-01T00:00:00.000Z",
    } as never);

    const result = await reencryptCredentials(db, KEYS);

    expect(result.unreadable).toEqual([{ source: "webhooks", id: "w1" }]);
    expect((await db.get(db.tables.webhooks, "w1"))?.["secretEncrypted"]).toBe(stranger);
  });

  it("counts a failed write and continues", async () => {
    const { db } = await seedUnderOld();
    const failing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "update") {
          return async () => {
            throw new Error("write failed");
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });

    const result = await reencryptCredentials(failing, KEYS);

    expect(result.failed).toBe(3);
    expect(result.reencrypted).toBe(0);
  });
});
