import { describe, expect, it, vi } from "vitest";
import { emitNotifications, emitSystemNotification } from "./events.ts";
import type { NotifierProvider } from "./provider.ts";
import type { NotificationChannel } from "./types.ts";

function channel(overrides: Partial<NotificationChannel> = {}): NotificationChannel {
  return {
    id: "ch1",
    projectId: "p1",
    provider: "log",
    config: {},
    events: [],
    enabled: true,
    ...overrides,
  };
}

function logProvider(sent: unknown[]): NotifierProvider {
  return {
    metadata: {
      name: "log",
      version: "0.0.0",
      kind: "log",
      category: "notifier",
      schema: {} as never,
    },
    create: () => ({
      metadata: {
        name: "log",
        version: "0.0.0",
        kind: "log",
        category: "notifier",
        schema: {} as never,
      },
      send: async (input) => {
        sent.push(input);
      },
    }),
  };
}

describe("emitNotifications", () => {
  it("skips disabled channels and event mismatches", async () => {
    const sent: unknown[] = [];
    const event = { event: "build:created", data: {}, timestamp: new Date().toISOString() };
    await emitNotifications(event, {
      notifiers: [logProvider(sent)],
      channels: [channel({ enabled: false }), channel({ id: "ch2", events: ["build:approved"] })],
    });
    expect(sent).toHaveLength(0);
  });

  it("delivers to subscribed channels and swallows provider failures", async () => {
    const sent: unknown[] = [];
    const failing: NotifierProvider = {
      metadata: {
        name: "bad",
        version: "0.0.0",
        kind: "bad",
        category: "notifier",
        schema: {} as never,
      },
      create: () => ({
        metadata: {
          name: "bad",
          version: "0.0.0",
          kind: "bad",
          category: "notifier",
          schema: {} as never,
        },
        send: async () => {
          throw new Error("boom");
        },
      }),
    };
    const event = { event: "build:created", data: {}, timestamp: new Date().toISOString() };
    await emitNotifications(event, {
      notifiers: [logProvider(sent), failing],
      channels: [
        channel(),
        channel({ id: "ch2", provider: "bad" }),
        channel({ id: "ch3", provider: "missing" }),
      ],
    });
    expect(sent).toHaveLength(1);
  });

  it("emits system alerts only to project-less channels", async () => {
    const sent: unknown[] = [];
    await emitSystemNotification(
      { event: "sys:purge-completed", data: {}, timestamp: new Date().toISOString() },
      {
        notifiers: [logProvider(sent)],
        channels: [channel(), channel({ id: "sys1", projectId: null })],
      },
    );
    expect(sent).toHaveLength(1);
  });

  it("uses the vi mock to assert send payload shape", async () => {
    const send = vi.fn(async () => {});
    const provider: NotifierProvider = {
      metadata: {
        name: "log",
        version: "0.0.0",
        kind: "log",
        category: "notifier",
        schema: {} as never,
      },
      create: () => ({
        metadata: {
          name: "log",
          version: "0.0.0",
          kind: "log",
          category: "notifier",
          schema: {} as never,
        },
        send,
      }),
    };
    await emitNotifications(
      { event: "build:created", data: {}, timestamp: new Date().toISOString() },
      { notifiers: [provider], channels: [channel()] },
    );
    expect(send).toHaveBeenCalledOnce();
  });
});
