import { AdapterLifecycleError } from "@storyshelf/core/adapter/setup";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";

const silentLogger = pino({ level: "silent" });

const admin = { id: "user_1", email: "ada@example.com", name: "Ada", role: "admin" as const };

const adminAuth = {
  metadata: { name: "Stub Auth", version: "0.0.0", kind: "stub", category: "auth" as const },
  check: async (): Promise<typeof admin> => {
    await Promise.resolve();
    return admin;
  },
  createSession: async (): Promise<string> => {
    await Promise.resolve();
    return "ok";
  },
  destroySession: async (): Promise<void> => {
    await Promise.resolve();
  },
};

const noSessionAuth = {
  metadata: { name: "Stub Auth", version: "0.0.0", kind: "stub", category: "auth" as const },
  check: async (): Promise<null> => {
    await Promise.resolve();
    return null;
  },
  createSession: async (): Promise<string> => {
    await Promise.resolve();
    return "ok";
  },
  destroySession: async (): Promise<void> => {
    await Promise.resolve();
  },
};

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
      error: string;
      failures: { category: string; kind: string }[];
    };
    expect(body.error).toContain("setup");
    expect(body.failures[0]?.category).toBe("database");
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
    const app = createShelfApp({ database: db, storage, logger: silentLogger });
    await app.lifecycle.setup();
    const response = await app.request("/api/v1/health", { method: "POST" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      adapters: { category: string; state: string }[];
    };
    expect(body.status).toBe("ok");
    expect(body.adapters.map((a) => a.category).toSorted()).toEqual(["database", "storage"]);
    expect(body.adapters.every((a) => a.state === "ok")).toBe(true);
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
});
