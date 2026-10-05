import { describe, expect, it } from "vitest";
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
