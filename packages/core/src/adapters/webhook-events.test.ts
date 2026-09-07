import { afterEach, describe, expect, it, vi } from "vitest";
import { WebhookModel } from "../models/webhook.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { hmacSha256 } from "../utils/hash.ts";
import { emitWebhookEvent } from "./webhook-events.ts";

const TEST_SECRET = "test-server-secret";

describe("emitWebhookEvent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("signs deliveries with the decrypted secret, not the ciphertext", async () => {
    const { db } = makeDatabase();
    const model = new WebhookModel(db, TEST_SECRET);
    await model.create("p1", {
      url: "https://example.com/hook",
      secret: "whsec-plain",
      events: [],
    });

    const seen: { url: string; signature: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
        await Promise.resolve();
        seen.push({
          url,
          signature: init.headers["X-StoryShelf-Signature"] ?? "",
          body: init.body,
        });
        return new Response("{}", { status: 200 });
      }),
    );

    await emitWebhookEvent(db, "p1", "build:created", { buildId: "b1" }, TEST_SECRET);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://example.com/hook");
    expect(seen[0]?.signature).toBe(hmacSha256("whsec-plain", seen[0]?.body ?? ""));
  });

  it("skips webhooks whose secret cannot be decrypted", async () => {
    const { db } = makeDatabase();
    const model = new WebhookModel(db, TEST_SECRET);
    await model.create("p1", {
      url: "https://example.com/hook",
      secret: "whsec-plain",
      events: [],
    });

    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await emitWebhookEvent(db, "p1", "build:created", { buildId: "b1" }, "wrong-server-secret");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("delivers only subscribed events", async () => {
    const { db } = makeDatabase();
    const model = new WebhookModel(db, TEST_SECRET);
    await model.create("p1", {
      url: "https://example.com/hook",
      secret: "s",
      events: ["build:created"],
    });

    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await emitWebhookEvent(db, "p1", "build:approved", { buildId: "b1" }, TEST_SECRET);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
