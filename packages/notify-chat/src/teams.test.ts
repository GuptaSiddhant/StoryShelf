import { afterEach, describe, expect, it, vi } from "vitest";
import { teamsWorkflowNotifier } from "./teams.ts";

const CHANNEL = {
  id: "ch1",
  projectId: "p1",
  provider: "teams-workflow",
  config: {},
  events: [],
  enabled: true,
};

const FORMATTED = {
  subject: "[Shelf] build:approved",
  text: "hello",
  markdown: "hello",
  html: "<p>hello</p>",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("teamsWorkflowNotifier", () => {
  it("posts an Adaptive Card to the workflow URL", async () => {
    const seen: { url: unknown; init: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init: unknown) => {
        seen.push({ url, init });
        await Promise.resolve();
        return new Response("", { status: 202 });
      }),
    );
    const sender = teamsWorkflowNotifier.create({
      config: {},
      secret: "https://example.webhook.office.com/x",
    });
    await sender.send({ channel: CHANNEL, formatted: FORMATTED });
    expect(seen).toHaveLength(1);
    const init = seen[0]?.init as { body: string } | undefined;
    expect(init).toBeDefined();
    const body = JSON.parse(init!.body) as {
      attachments: { contentType: string }[];
    };
    expect(body.attachments[0]?.contentType).toBe("application/vnd.microsoft.card.adaptive");
  });

  it("throws when the workflow URL secret is missing", async () => {
    const sender = teamsWorkflowNotifier.create({ config: {} });
    await expect(sender.send({ channel: CHANNEL, formatted: FORMATTED })).rejects.toThrow(
      "workflow URL",
    );
  });
});
