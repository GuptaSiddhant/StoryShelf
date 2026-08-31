import { describe, expect, it } from "vitest";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { WebhookModel } from "./webhook.ts";
import { makeDatabase } from "./fake-adapters.ts";

describe("WebhookModel", () => {
  it("creates a webhook for a project", async () => {
    const db = makeDatabase();
    const model = new WebhookModel(db);
    const webhook = await model.create("p1", "https://example.com/webhook", "secret-123", ["push", "pull_request"]);
    expect(webhook.id).toBeDefined();
    expect(webhook.url).toBe("https://example.com/webhook");
    expect(webhook.secret).toBe("secret-123");
    expect(webhook.events).toContain("push");
    expect(webhook.events).toContain("pull_request");
  });

  it "gets a webhook by id", async () => {
    const db = makeDatabase();
    const model = new WebhookModel(db);
    const webhook = await model.create("p1", "https://example.com/webhook", "secret-123", ["push"]);
    const fetched = await model.get("p1", webhook.id);
    expect(fetched?.id).toBe(webhook.id);
    expect(fetched?.url).toBe("https://example.com/webhook");
  });

  it "lists webhooks for a project", async () => {
    const db = makeDatabase();
    const model = new WebhookModel(db);
    await model.create("p1", "https://webhook1.com", "secret-1", ["push"]);
    await model.create("p1", "https://webhook2.com", "secret-2", ["pull_request"]);
    const webhooks = await model.list("p1");
    expect(webhooks.length).toBe(2);
  });

  it "removes a webhook", async () => {
    const db = makeDatabase();
    const model = new WebhookModel(db);
    const webhook = await model.create("p1", "https://webhook.com", "secret", ["push"]);
    await model.remove("p1", webhook.id);
    const webhooks = await model.list("p1");
    expect(webhooks.length).toBe(0);
  });
});