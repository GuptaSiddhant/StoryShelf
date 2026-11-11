import type { NotifierProvider } from "@storyshelf/core/adapter/notifier";
import { BuildModel } from "@storyshelf/core/models";
import {
  createTestBuild,
  createTestProject,
  makeDatabase,
  makeStorage,
  publicNetworkForTests,
} from "@storyshelf/core/test-helpers";
import { createHmac } from "node:crypto";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createShelfApp } from "../index.tsx";
import { stubRunner } from "../test-runner.ts";

/** A webhook sits outside the notification-origin gate (ADR 0014): it names ids, never links. */

/** A chat notifier that records everything it is asked to send. */
function recordingChat(sent: string[]): NotifierProvider {
  const metadata = {
    name: "log",
    version: "0.0.0",
    kind: "log",
    category: "notifier" as const,
    schema: z.object({}).loose(),
  };
  return {
    metadata,
    create: () => ({
      metadata,
      // oxlint-disable-next-line eslint/require-await -- send is async by contract
      send: async (input: unknown) => {
        sent.push((input as { formatted: { subject: string } }).formatted.subject);
      },
    }),
  };
}

interface Delivery {
  url: string;
  headers: Record<string, string>;
  raw: string;
  body: { event: string; projectId: string; data: Record<string, unknown> };
}

/** Stub `fetch`: every webhook POST is recorded and answered 200. */
function stubWebhookReceiver(): Delivery[] {
  const deliveries: Delivery[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
      await Promise.resolve();
      deliveries.push({
        url,
        headers: init.headers,
        raw: init.body,
        body: JSON.parse(init.body),
      });
      return new Response("{}", { status: 200 });
    }),
  );
  return deliveries;
}

/** An app with NO public origin (no `publicBaseUrl`), a chat channel and a webhook on one build. */
async function seed(chat: string[], publicBaseUrl?: string) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const project = await createTestProject(db, db.tables, { name: "web" });
  const build = await createTestBuild(db, db.tables, project.id);
  await new BuildModel(db).setStatus(build.id, "pending");
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    config: { secret: "s", ...(publicBaseUrl === undefined ? {} : { publicBaseUrl }) },
    notifications: { notifiers: [recordingChat(chat)] },
    testing: { runner: stubRunner() },
  });
  const channel = await app.request("/api/v1/projects/web/notification-channels", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "log", config: {} }),
  });
  expect(channel.status).toBe(201);
  const webhook = await app.request("/api/v1/projects/web/webhooks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://hooks.example/receive" }),
  });
  expect(webhook.status).toBe(201);
  const { secret } = (await webhook.json()) as { secret: string };
  apps.push(app);
  return { app, build, secret, cancel: `/api/v1/projects/web/builds/${build.id}/cancel` };
}

/** Every app a test booted, torn down even when an assertion failed (each runs a branch-GC timer). */
const apps: ReturnType<typeof createShelfApp>[] = [];
let restoreNetwork: (() => void) | undefined;
beforeEach(() => {
  restoreNetwork = publicNetworkForTests();
});
afterEach(async () => {
  restoreNetwork?.();
  vi.unstubAllGlobals();
  await Promise.allSettled(apps.splice(0).map(async (app) => await app.lifecycle.teardown()));
});

describe("a webhook while no public origin resolves", () => {
  it("is delivered and signed, while chat stays paused", async () => {
    const chat: string[] = [];
    const deliveries = stubWebhookReceiver();
    const { app, cancel, secret } = await seed(chat);
    expect((await app.request(cancel, { method: "POST" })).status).toBe(200);
    await vi.waitFor(() => {
      expect(deliveries.map((delivery) => delivery.body.event)).toContain("build:cancelled");
    });
    const delivery = deliveries.find((item) => item.body.event === "build:cancelled");
    expect(delivery?.url).toBe("https://hooks.example/receive");
    const headers = Object.fromEntries(
      Object.entries(delivery?.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
    );
    expect(headers["x-storyshelf-event"]).toBe("build:cancelled");
    expect(headers["x-storyshelf-signature"]).toBe(
      createHmac("sha256", secret)
        .update(delivery?.raw ?? "")
        .digest("hex"),
    );
    expect(chat).toEqual([]);
  });

  it("names ids only: no link, and so no origin, is in the payload", async () => {
    const deliveries = stubWebhookReceiver();
    const { app, build, cancel } = await seed([]);
    await app.request(cancel, { method: "POST" });
    await vi.waitFor(() => {
      expect(deliveries.length).toBeGreaterThan(0);
    });
    const payload = JSON.stringify(deliveries.map((delivery) => delivery.body));
    expect(payload).toContain(build.id);
    expect(payload).not.toMatch(/https?:\/\//u);
  });

  it("does not change what chat gets once an origin is set: the pause is chat's alone", async () => {
    const chat: string[] = [];
    const deliveries = stubWebhookReceiver();
    const { app, cancel } = await seed(chat, "https://shelf.example");
    await app.request(cancel, { method: "POST" });
    await vi.waitFor(() => {
      expect(chat.join("\n")).toContain("build:cancelled");
    });
    expect(deliveries.map((delivery) => delivery.body.event)).toContain("build:cancelled");
  });
});
