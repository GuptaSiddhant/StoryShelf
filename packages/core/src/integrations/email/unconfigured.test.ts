import { describe, expect, it, vi } from "vitest";
import type { MessageNotifierAdapter } from "../../adapters/notifier/index.ts";
import { builtInEmailNotifier } from "./index.ts";
import { NOT_CONFIGURED, unconfiguredSender } from "./unconfigured.ts";

const MESSAGE = { to: "a@b.c", subject: "s", text: "t" };

const FORMATTED = { subject: "s", text: "t", markdown: "t", html: "<p>t</p>" };

const CHANNEL = {
  id: "ch1",
  projectId: "p1",
  provider: "email",
  config: { to: "team@example.com" },
  events: [],
  enabled: true,
};

describe("unconfiguredSender", () => {
  it("sends nothing: a send fails with the fix named", async () => {
    await expect(unconfiguredSender().send(MESSAGE)).rejects.toThrow(NOT_CONFIGURED);
  });

  it("reports itself as not configured", async () => {
    const health = await unconfiguredSender().lifecycle?.health();
    expect(health).toEqual({ ok: false, detail: NOT_CONFIGURED });
  });
});

describe("the built-in email notifier", () => {
  it("is the email provider", () => {
    expect(builtInEmailNotifier().metadata.kind).toBe("email");
  });

  it("delivers nothing through a channel while no transport is configured", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const adapter = builtInEmailNotifier().create({
      config: { to: "team@example.com" },
    }) as unknown as MessageNotifierAdapter;
    await expect(adapter.send({ channel: CHANNEL, formatted: FORMATTED } as never)).rejects.toThrow(
      NOT_CONFIGURED,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
