import { describe, expect, it } from "vitest";
import { webhooks } from "../../../db-sqlite/src/schema/index.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { WebhookModel } from "./webhook.ts";

const TEST_SECRET = "test-server-secret";

function model(db: ReturnType<typeof makeDatabase>["db"]): WebhookModel {
  return new WebhookModel(db, { webhooks }, TEST_SECRET);
}

describe("WebhookModel", () => {
  it("creates a webhook with an encrypted secret", async () => {
    const { db } = makeDatabase();
    const webhook = await model(db).create("p1", {
      url: "https://example.com/webhook",
      secret: "secret-123",
      events: ["push", "pull_request"],
    });
    expect(webhook.id).toBeDefined();
    expect(webhook.url).toBe("https://example.com/webhook");
    expect(webhook.secretEncrypted).not.toBe("secret-123");
    expect(webhook.secretEncrypted).toContain(":");
    expect(webhook.events).toContain("push");
    expect(webhook.events).toContain("pull_request");
  });

  it("round-trips the secret through decryptSecret", async () => {
    const { db } = makeDatabase();
    const created = await model(db).create("p1", {
      url: "https://example.com/webhook",
      secret: "secret-123",
      events: ["push"],
    });
    expect(model(db).decryptSecret(created)).toBe("secret-123");
  });

  it("throws on create when the server secret is unset", async () => {
    const { db } = makeDatabase();
    const withoutSecret = new WebhookModel(db, { webhooks });
    await expect(
      withoutSecret.create("p1", { url: "https://example.com/webhook", secret: "s", events: [] }),
    ).rejects.toThrow("secret is not configured");
  });

  it("throws on decrypt when the server secret is unset", async () => {
    const { db } = makeDatabase();
    const created = await model(db).create("p1", {
      url: "https://example.com/webhook",
      secret: "secret-123",
      events: [],
    });
    expect(() => new WebhookModel(db, { webhooks }).decryptSecret(created)).toThrow(
      "secret is not configured",
    );
  });

  it("gets a webhook by id", async () => {
    const { db } = makeDatabase();
    const webhook = await model(db).create("p1", {
      url: "https://example.com/webhook",
      secret: "secret-123",
      events: ["push"],
    });
    const fetched = await model(db).get("p1", webhook.id);
    expect(fetched?.id).toBe(webhook.id);
    expect(fetched?.url).toBe("https://example.com/webhook");
  });

  it("lists webhooks for a project", async () => {
    const { db } = makeDatabase();
    await model(db).create("p1", {
      url: "https://webhook1.com",
      secret: "secret-1",
      events: ["push"],
    });
    await model(db).create("p1", {
      url: "https://webhook2.com",
      secret: "secret-2",
      events: ["pull_request"],
    });
    const listed = await model(db).list("p1");
    expect(listed.length).toBe(2);
  });

  it("removes a webhook", async () => {
    const { db } = makeDatabase();
    const webhook = await model(db).create("p1", {
      url: "https://webhook.com",
      secret: "secret",
      events: ["push"],
    });
    await model(db).remove("p1", webhook.id);
    const listed = await model(db).list("p1");
    expect(listed.length).toBe(0);
  });
});
