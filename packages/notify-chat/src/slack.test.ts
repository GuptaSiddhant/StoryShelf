import { afterEach, describe, expect, it, vi } from "vitest";
import { slackWebhookNotifier } from "./slack.ts";

const CHANNEL = {
  id: "ch1",
  projectId: "p1",
  provider: "slack-webhook",
  config: {},
  events: [],
  enabled: true,
};

const FORMATTED = {
  subject: "[Shelf] build:reviewing",
  text: "hello",
  markdown: "hello",
  html: "<p>hello</p>",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("slackWebhookNotifier", () => {
  it("posts Block Kit payload to the webhook URL", async () => {
    const seen: { url: unknown; init: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init: unknown) => {
        seen.push({ url, init });
        await Promise.resolve();
        return new Response("ok", { status: 200 });
      }),
    );
    const sender = slackWebhookNotifier.create({
      config: {},
      secret: "https://hooks.slack.com/services/x",
    });
    await sender.send({ channel: CHANNEL, formatted: FORMATTED });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://hooks.slack.com/services/x");
    const init = seen[0]?.init as { body: string } | undefined;
    expect(init).toBeDefined();
    const body = JSON.parse(init!.body) as {
      blocks: unknown[];
    };
    expect(body.blocks).toHaveLength(1);
  });

  it("throws when the webhook URL secret is missing", async () => {
    const sender = slackWebhookNotifier.create({ config: {} });
    await expect(sender.send({ channel: CHANNEL, formatted: FORMATTED })).rejects.toThrow(
      "webhook URL",
    );
  });

  it("rejects invalid config", () => {
    expect(() => slackWebhookNotifier.create({ config: { style: "huge" } })).toThrow();
  });
});
