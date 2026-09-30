import { afterEach, describe, expect, it, vi } from "vitest";
import { httpPreset, logPreset } from "./client.ts";
import { createEmailNotifier } from "./email.ts";

const FORMATTED = {
  subject: "[Shelf] build:reviewing",
  text: "hello",
  markdown: "hello",
  html: "<p>hello</p>",
};

const CHANNEL = {
  id: "ch1",
  projectId: "p1",
  provider: "email",
  config: { to: "team@example.com" },
  events: [],
  enabled: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("logPreset", () => {
  it("records sends on the logger without delivering", async () => {
    const info = vi.fn();
    const sender = logPreset({ logger: { info, child: () => ({ info }) } as never });
    await sender.send({ to: "a@example.com", subject: "s", text: "t" });
    expect(info).toHaveBeenCalledOnce();
  });
});

describe("httpPreset", () => {
  it("posts message JSON to the endpoint", async () => {
    const seen: { url: unknown; init: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init: unknown) => {
        seen.push({ url, init });
        await Promise.resolve();
        return new Response("{}", { status: 200 });
      }),
    );
    const sender = httpPreset({ url: "https://api.example.com/mail", from: "shelf@example.com" });
    await sender.send({ to: "a@example.com", subject: "s", text: "t" });
    expect(seen).toHaveLength(1);
    const init = seen[0]?.init as { body: string } | undefined;
    expect(init).toBeDefined();
    expect(JSON.parse(init!.body) as Record<string, unknown>).toMatchObject({
      to: "a@example.com",
      subject: "s",
    });
  });
});

describe("createEmailNotifier", () => {
  it("maps formatted output onto the shared transport", async () => {
    const sent: unknown[] = [];
    const provider = createEmailNotifier({
      metadata: { name: "t", version: "0", kind: "t", category: "notifier" },
      send: async (message) => {
        sent.push(message);
      },
    });
    const sender = provider.create({ config: { to: "team@example.com" } });
    await sender.send({ channel: CHANNEL, formatted: FORMATTED });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "team@example.com", subject: FORMATTED.subject });
  });

  it("rejects channel config without a recipient", () => {
    const provider = createEmailNotifier({
      metadata: { name: "t", version: "0", kind: "t", category: "notifier" },
      send: async () => {},
    });
    expect(() => provider.create({ config: {} })).toThrow();
  });
});
