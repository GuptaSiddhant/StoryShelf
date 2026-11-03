import type { Logger } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reencryptCredentials } from "../models/credentials.ts";
import { WebhookModel } from "../models/webhook.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { hmacSha256 } from "../utils/hash.ts";
import type { DatabaseAdapter } from "./database.ts";
import { emitWebhookEvent } from "./webhook-events.ts";

const TEST_SECRET = "test-server-secret";

function webhookTables(db: DatabaseAdapter) {
  return { webhooks: db.tables.webhooks };
}

function emitTo(db: DatabaseAdapter, logger: Logger): Promise<void> {
  return emitWebhookEvent(db, webhookTables(db), "p1", "build:created", {}, TEST_SECRET, logger);
}

function expectNoUrlSecrets(lines: string[]): void {
  for (const secret of ["SECRETPATH", "token=abc"]) {
    expect(lines.join("\n")).not.toContain(secret);
  }
}

/** Which `X-StoryShelf-Event` headers a webhook filtering on `subscribed` receives for one comment. */
async function received(subscribed: string[], scope: string): Promise<string[]> {
  const { db } = makeDatabase();
  await new WebhookModel(db, webhookTables(db), TEST_SECRET).create("p1", {
    url: "https://example.com/hook",
    secret: "whsec-plain",
    events: subscribed,
  });
  const headers: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
      await Promise.resolve();
      headers.push(init.headers["X-StoryShelf-Event"] ?? "");
      return new Response("{}", { status: 200 });
    }),
  );
  await emitWebhookEvent(
    db,
    webhookTables(db),
    "p1",
    "comment:created",
    { scope, buildId: "b1" },
    TEST_SECRET,
  );
  return headers;
}

describe("emitWebhookEvent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("signs deliveries with the decrypted secret, not the ciphertext", async () => {
    const { db } = makeDatabase();
    const model = new WebhookModel(db, webhookTables(db), TEST_SECRET);
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

    await emitWebhookEvent(
      db,
      webhookTables(db),
      "p1",
      "build:created",
      { buildId: "b1" },
      TEST_SECRET,
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://example.com/hook");
    expect(seen[0]?.signature).toBe(hmacSha256("whsec-plain", seen[0]?.body ?? ""));
  });

  it("skips webhooks whose secret cannot be decrypted", async () => {
    const { db } = makeDatabase();
    const model = new WebhookModel(db, webhookTables(db), TEST_SECRET);
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

    await emitWebhookEvent(
      db,
      webhookTables(db),
      "p1",
      "build:created",
      { buildId: "b1" },
      "wrong-server-secret",
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("delivers only subscribed events", async () => {
    const { db } = makeDatabase();
    const model = new WebhookModel(db, webhookTables(db), TEST_SECRET);
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

    await emitWebhookEvent(
      db,
      webhookTables(db),
      "p1",
      "build:approved",
      { buildId: "b1" },
      TEST_SECRET,
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps delivering across a secret rotation, before and after re-encryption", async () => {
    const { db } = makeDatabase();
    await new WebhookModel(db, webhookTables(db), "old-secret").create("p1", {
      url: "https://example.com/hook",
      secret: "whsec-rotated",
      events: [],
    });
    const signatures: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { headers: Record<string, string>; body: string }) => {
        await Promise.resolve();
        signatures.push(init.headers["X-StoryShelf-Signature"] ?? "");
        return new Response("{}", { status: 200 });
      }),
    );
    const keys = { current: "new-secret", previous: "old-secret" };

    await emitWebhookEvent(db, webhookTables(db), "p1", "build:created", {}, keys);
    await reencryptCredentials(db, keys);
    await emitWebhookEvent(db, webhookTables(db), "p1", "build:created", {}, "new-secret");

    expect(signatures).toHaveLength(2);
    expect(signatures.every((signature) => signature.length === 64)).toBe(true);
  });

  describe("the review:comment filter alias", () => {
    it("keeps delivering build and story comments to a webhook that lists review:comment", async () => {
      expect(await received(["review:comment"], "build")).toEqual(["comment:created"]);
      expect(await received(["review:comment"], "story")).toEqual(["comment:created"]);
    });

    it("does not deliver snapshot comments to the alias, and delivers once when both names are listed", async () => {
      expect(await received(["review:comment"], "snapshot")).toEqual([]);
      expect(await received(["review:comment", "comment:created"], "story")).toEqual([
        "comment:created",
      ]);
      expect(await received(["review:comment", "comment:created"], "snapshot")).toEqual([
        "comment:created",
      ]);
    });
  });

  it("never reads the receiver's response body, on 2xx or on an error", async () => {
    const { db } = makeDatabase();
    await new WebhookModel(db, webhookTables(db), TEST_SECRET).create("p1", {
      url: "https://example.com/hook",
      secret: "whsec-plain",
      events: [],
    });
    const statuses = [200, 500];
    const cancelled: boolean[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await Promise.resolve();
        const index = cancelled.push(false) - 1;
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new Uint8Array(1024));
          },
          cancel() {
            cancelled[index] = true;
          },
        });
        return new Response(body, { status: statuses.shift() ?? 200 });
      }),
    );
    vi.stubGlobal("setTimeout", (callback: () => void) => {
      callback();
      return 0;
    });

    await emitWebhookEvent(db, webhookTables(db), "p1", "build:created", {}, TEST_SECRET);
    await emitWebhookEvent(db, webhookTables(db), "p1", "build:created", {}, TEST_SECRET);

    expect(cancelled.length).toBeGreaterThanOrEqual(2);
    expect(cancelled.every(Boolean)).toBe(true);
  });

  describe("delivery outcome", () => {
    const URL_WITH_SECRET = "https://hooks.example.com/in/SECRETPATH?token=abc";

    async function setup(): Promise<{
      db: DatabaseAdapter;
      lines: string[];
      logger: Logger;
    }> {
      const { db } = makeDatabase();
      await new WebhookModel(db, webhookTables(db), TEST_SECRET).create("p1", {
        url: URL_WITH_SECRET,
        secret: "whsec-plain",
        events: [],
      });
      const lines: string[] = [];
      const record =
        (level: string) =>
        (...args: unknown[]): void => {
          lines.push(JSON.stringify({ level, args }));
        };
      const logger = { debug: record("debug"), info: record("info"), warn: record("warn") };
      return { db, lines, logger: logger as unknown as Logger };
    }

    it("logs delivered for a 2xx answer", async () => {
      const { db, lines, logger } = await setup();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("ok", { status: 200 })),
      );
      await emitTo(db, logger);
      expect(lines.some((line) => line.includes("webhook delivered"))).toBe(true);
      expect(lines.some((line) => line.includes("webhook delivery failed"))).toBe(false);
      expect(lines.some((line) => line.includes('"host":"hooks.example.com"'))).toBe(true);
      expectNoUrlSecrets(lines);
    });

    it.each([404, 500])("logs failed, not delivered, for a %i answer", async (status) => {
      const { db, lines, logger } = await setup();
      const fetchMock = vi.fn(async () => new Response("nope", { status }));
      vi.stubGlobal("fetch", fetchMock);
      await emitTo(db, logger);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(lines.some((line) => line.includes("webhook delivery failed"))).toBe(true);
      expect(lines.some((line) => line.includes("webhook delivered"))).toBe(false);
      expect(lines.some((line) => line.includes('"host":"hooks.example.com"'))).toBe(true);
      expectNoUrlSecrets(lines);
    });

    it("logs failed after a network error exhausts the default retries", async () => {
      // Retry backoff sleeps through the global `setTimeout`; run it at once instead of waiting.
      vi.stubGlobal("setTimeout", (callback: () => void) => {
        callback();
        return 0;
      });
      const { db, lines, logger } = await setup();
      const fetchMock = vi.fn(async () => {
        throw new TypeError("fetch failed");
      });
      vi.stubGlobal("fetch", fetchMock);
      await emitTo(db, logger);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(lines.some((line) => line.includes("webhook delivery failed"))).toBe(true);
      expect(lines.some((line) => line.includes("webhook delivered"))).toBe(false);
      expectNoUrlSecrets(lines);
    });

    it("sends the event headers and a signature over the exact body sent", async () => {
      const { db, logger } = await setup();
      const seen: { headers: Record<string, string>; body: string }[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: { headers: Record<string, string>; body: string }) => {
          seen.push({ headers: init.headers, body: init.body });
          return new Response("ok", { status: 200 });
        }),
      );
      await emitTo(db, logger);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.headers["X-StoryShelf-Event"]).toBe("build:created");
      expect(seen[0]?.headers["X-StoryShelf-Signature"]).toBe(
        hmacSha256("whsec-plain", seen[0]?.body ?? ""),
      );
      expect(JSON.parse(seen[0]?.body ?? "")).toMatchObject({ event: "build:created" });
    });
  });
});
