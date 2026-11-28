import type { CaptureRunner } from "@storyshelf/core/adapter/capture-runner";
import { AdapterLifecycleError } from "@storyshelf/core/adapter/setup";
import { reachabilityOf } from "@storyshelf/core/capture";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";

const silentLogger = pino({ level: "silent" });

const admin = { id: "user_1", email: "ada@example.com", name: "Ada", role: "admin" as const };

const adminAuth = stubAuth(admin);

const noSessionAuth = stubAuth(null);

function brokenLifecycle(message: string): {
  setup: () => Promise<void>;
  teardown: () => Promise<void>;
  health: () => Promise<{ ok: boolean }>;
} {
  return {
    setup: async (): Promise<void> => {
      await Promise.resolve();
      throw new Error(message);
    },
    teardown: async (): Promise<void> => {
      await Promise.resolve();
    },
    health: async () => ({ ok: true }),
  };
}

describe("app.lifecycle", () => {
  it("setup resolves when no adapter exposes hooks", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({ database: db, storage, logger: silentLogger });
    await expect(app.lifecycle.setup()).resolves.toBeUndefined();
    await expect(app.lifecycle.ready).resolves.toMatchObject({ ok: true });
  });

  it("teardown resolves when no adapter exposes hooks", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({ database: db, storage, logger: silentLogger });
    await expect(app.lifecycle.teardown()).resolves.toBeUndefined();
  });

  it("exposes the passed logger instance", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({ database: db, storage, logger: silentLogger });
    expect(app.lifecycle.logger).toBe(silentLogger);
  });

  it("defaults to a working logger when omitted", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({ database: db, storage });
    expect(typeof app.lifecycle.logger.info).toBe("function");
    expect(typeof app.lifecycle.logger.child).toBe("function");
  });

  it("setup throws AdapterLifecycleError naming the failed adapter", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const broken = { ...db, lifecycle: brokenLifecycle("db down") };
    const app = createShelfApp({ database: broken, storage, logger: silentLogger });
    const failure = await app.lifecycle.setup().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AdapterLifecycleError);
    const setupError = failure as AdapterLifecycleError;
    expect(setupError.phase).toBe("setup");
    expect(setupError.failures).toHaveLength(1);
    expect(setupError.failures[0]?.category).toBe("database");
    expect(setupError.message).toContain("database");
  });

  it("gates API requests with 503 after failed setup", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const broken = { ...db, lifecycle: brokenLifecycle("db down") };
    const app = createShelfApp({ database: broken, storage, logger: silentLogger });
    await app.lifecycle.ready;
    const response = await app.request("/api/v1/projects");
    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      error: { message: string; failures: { category: string; kind: string }[] };
    };
    expect(body.error.message).toContain("setup");
    expect(body.error.failures[0]?.category).toBe("database");
  });
});

describe("health endpoints", () => {
  it("GET /api/v1/health answers liveness without auth or setup", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({ database: db, storage, logger: silentLogger });
    const response = await app.request("/api/v1/health");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; uptimeSecs: number; version: string };
    expect(body.status).toBe("ok");
    expect(body.uptimeSecs).toBeGreaterThanOrEqual(0);
    expect(typeof body.version).toBe("string");
    expect((body as { testing?: boolean }).testing).toBe(false);
    expect((body as { ai?: boolean }).ai).toBe(false);
    expect((body as { auth?: boolean }).auth).toBe(false);
  });

  it("GET /api/v1/health reports AI on only when AI is configured", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const ai = { health: async () => ({ ok: true }), setup: async () => {} };
    const app = createShelfApp({ database: db, storage, ai: ai as never, logger: silentLogger });
    await app.lifecycle.setup();
    const body = (await (await app.request("/api/v1/health")).json()) as { ai?: boolean };
    expect(body.ai).toBe(true);
  });

  it("GET /api/v1/health reports whether sign-in is on", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({ database: db, storage, auth: adminAuth, logger: silentLogger });
    const body = (await (await app.request("/api/v1/health")).json()) as { auth: boolean };
    expect(body.auth).toBe(true);
  });

  it("GET /api/v1/health stays 200 after failed setup", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const broken = { ...db, lifecycle: brokenLifecycle("db down") };
    const app = createShelfApp({ database: broken, storage, logger: silentLogger });
    await app.lifecycle.ready;
    const response = await app.request("/api/v1/health");
    expect(response.status).toBe(200);
  });

  it("POST /api/v1/health is open when auth is disabled", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({ database: db, storage, logger: silentLogger, design: false });
    await app.lifecycle.setup();
    const response = await app.request("/api/v1/health", { method: "POST" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      adapters: { category: string; state: string }[];
      integrations: { kind: string; state: string; reason?: string }[];
    };
    expect(body.status).toBe("ok");
    // Email has no sender here, so it is not wired (#1126); the six other built-in notifiers are.
    expect(body.adapters.map((a) => a.category).toSorted()).toEqual([
      "database",
      ...Array.from({ length: 6 }, () => "notifier"),
      "storage",
    ]);
    expect(body.adapters.every((a) => a.state === "ok")).toBe(true);
    const byKind = new Map(body.integrations.map((entry) => [entry.kind, entry]));
    expect(byKind.get("email")?.state).toBe("unavailable");
    expect(byKind.get("email")?.reason).toContain("SMTP_HOST");
    expect(byKind.get("figma")?.state).toBe("disabled");
    expect(byKind.get("slack-webhook")?.state).toBe("available");
  });

  it("POST /api/v1/health reports setup failures as degraded", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const broken = { ...db, lifecycle: brokenLifecycle("db down") };
    const app = createShelfApp({ database: broken, storage, logger: silentLogger });
    await app.lifecycle.ready;
    const response = await app.request("/api/v1/health", { method: "POST" });
    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      status: string;
      adapters: { category: string; state: string }[];
    };
    expect(body.status).toBe("degraded");
    expect(body.adapters.find((a) => a.category === "database")?.state).toBe("failed");
  });

  it("POST /api/v1/health requires a session when auth is enabled", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({
      database: db,
      storage,
      auth: noSessionAuth,
      logger: silentLogger,
    });
    await app.lifecycle.setup();
    const response = await app.request("/api/v1/health", { method: "POST" });
    expect(response.status).toBe(403);
  });

  it("POST /api/v1/health allows site admins", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({ database: db, storage, auth: adminAuth, logger: silentLogger });
    await app.lifecycle.setup();
    const response = await app.request("/api/v1/health", { method: "POST" });
    expect(response.status).toBe(200);
  });
  it("POST /api/v1/health adds the AI probe and the status rows; GET gains neither", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const ai = { health: async () => ({ ok: true }), setup: async () => {} };
    const app = createShelfApp({
      database: db,
      storage,
      auth: adminAuth,
      ai: ai as never,
      logger: silentLogger,
    });
    await app.lifecycle.setup();
    const deep = (await (await app.request("/api/v1/health", { method: "POST" })).json()) as {
      adapters: { category: string; kind: string; state: string }[];
      statuses: { id: string }[];
    };
    expect(deep.adapters).toContainEqual(
      expect.objectContaining({ category: "ai", kind: "ai", state: "ok" }),
    );
    expect(deep.statuses.map((row) => row.id)).toEqual([
      "telemetry",
      "image-engine",
      "public-origin",
      "hosting",
    ]);
    const open = await (await app.request("/api/v1/health")).json();
    expect(Object.keys(open as object).toSorted()).toEqual([
      "ai",
      "auth",
      "status",
      "testing",
      "uptimeSecs",
      "version",
    ]);
  });

  it("POST /api/v1/health lists each target for admins; GET and non-admins never see it", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const base = stubRunner();
    const runner = {
      ...base,
      metadata: {
        ...base.metadata,
        targets: [{ target: "chromium@sprite", reach: "loopback", status: "ready" }],
      },
    } as CaptureRunner;
    const app = createShelfApp({
      database: db,
      storage,
      auth: adminAuth,
      testing: { runner },
      logger: silentLogger,
    });
    await app.lifecycle.setup();
    const read = async (): Promise<{ targets: Record<string, string> }> =>
      (await (await app.request("/api/v1/health", { method: "POST" })).json()) as {
        targets: Record<string, string>;
      };
    expect((await read()).targets).toEqual({ "chromium@sprite": "ok" });
    await reachabilityOf(runner).failed("chromium@sprite", "connection");
    const body = await read();
    expect(body.targets).toEqual({ "chromium@sprite": "unreachable" });
    // The class and time are for the System page: the API answers only ok or unreachable.
    expect(JSON.stringify(body)).not.toContain("connection");
    const open = await (await app.request("/api/v1/health")).json();
    expect(JSON.stringify(open)).not.toContain("targets");
  });

  it("POST /api/v1/health refuses a signed-in user who is not a site admin", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const member = stubAuth({ ...admin, role: "member" as never });
    const app = createShelfApp({ database: db, storage, auth: member, logger: silentLogger });
    await app.lifecycle.setup();
    expect((await app.request("/api/v1/health", { method: "POST" })).status).toBe(403);
  });
});
