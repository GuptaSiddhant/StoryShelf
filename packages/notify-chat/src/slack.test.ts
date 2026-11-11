import type { Logger } from "@storyshelf/core/logger";
import { publicNetworkForTests } from "@storyshelf/core/test-helpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
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

let restoreNetwork: (() => void) | undefined;
beforeEach(() => {
  restoreNetwork = publicNetworkForTests();
});

afterEach(() => {
  restoreNetwork?.();
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

  it("never logs the webhook path when a send is retried", async () => {
    const url = "https://hooks.slack.com/services/T000/B000/SECRETxyz?token=abc";
    vi.stubGlobal(
      "fetch",
      vi
        .fn<() => Promise<Response>>()
        .mockResolvedValueOnce(
          new Response("busy", { status: 503, headers: { "retry-after": "0" } }),
        )
        .mockResolvedValueOnce(new Response("ok", { status: 200 })),
    );
    const lines: string[] = [];
    const record =
      (level: string) =>
      (...args: unknown[]): void => {
        lines.push(JSON.stringify({ level, args }));
      };
    const logger = { debug: record("debug"), warn: record("warn"), info: record("info") };
    const child = { ...logger, child: () => child };
    const sender = slackWebhookNotifier.create({
      config: {},
      secret: url,
      logger: child as unknown as Logger,
    });
    await sender.send({ channel: CHANNEL, formatted: FORMATTED });
    expect(lines.some((line) => line.includes("http request failed, retrying"))).toBe(true);
    for (const secret of ["SECRETxyz", "T000", "B000", "abc"]) {
      expect(lines.join("\n")).not.toContain(secret);
    }
  });
});
