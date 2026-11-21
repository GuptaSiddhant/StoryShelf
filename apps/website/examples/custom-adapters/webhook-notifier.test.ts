import type { NotificationChannel } from "@storyshelf/core/adapter/notifier";
import { notifierContractSuite, publicNetworkForTests } from "@storyshelf/core/test-helpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonWebhookNotifier } from "./webhook-notifier.ts";

const formatted = { subject: "Build approved", text: "ok", markdown: "ok", html: "<p>ok</p>" };
const channel = {
  id: "chan-1",
  projectId: "proj-1",
  provider: "json-webhook",
} as NotificationChannel;
const url = "https://hooks.example.com/T123/secret-path";
let restore: () => void;
const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => new Response("ok"));

beforeEach(() => {
  vi.stubGlobal("fetch", fetchSpy);
  restore = publicNetworkForTests();
});
afterEach(() => {
  restore();
  vi.unstubAllGlobals();
  fetchSpy.mockClear();
});

// The shared structural contract: metadata, create descriptor and a real config schema.
notifierContractSuite("json-webhook", () => jsonWebhookNotifier);

describe("json-webhook notifier", () => {
  it("posts the subject and text to the secret URL", async () => {
    const adapter = jsonWebhookNotifier.create({ config: { prefix: "[shelf]" }, secret: url });
    await adapter.send({ channel, formatted });
    const [target, init] = fetchSpy.mock.calls[0] ?? [];
    expect(target).toBe(url);
    expect(JSON.parse(String(init?.body))).toEqual({
      subject: "[shelf] Build approved",
      text: "ok",
    });
  });

  it("throws on a refused delivery so the job retries, without the URL in the error", async () => {
    fetchSpy.mockResolvedValue(new Response("nope", { status: 400 }));
    const adapter = jsonWebhookNotifier.create({ config: {}, secret: url });
    const failure = await adapter.send({ channel, formatted }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain("secret-path");
  });

  it("rejects an invalid config and a missing secret", async () => {
    expect(() => jsonWebhookNotifier.create({ config: { prefix: "" }, secret: url })).toThrow();
    const adapter = jsonWebhookNotifier.create({ config: {} });
    await expect(adapter.send({ channel, formatted })).rejects.toThrow("missing its URL secret");
  });
});
