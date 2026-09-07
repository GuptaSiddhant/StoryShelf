import { AdapterLifecycleError } from "@storyshelf/core/adapter/init";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfRouter } from "../index.tsx";

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

describe("app.lifecycle", () => {
  it("init resolves when no adapter exposes hooks", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfRouter({ database: db, storage, logger: silentLogger });
    await expect(app.lifecycle.init()).resolves.toBeUndefined();
    await expect(app.lifecycle.ready).resolves.toMatchObject({ ok: true });
  });

  it("close resolves when no adapter exposes hooks", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfRouter({ database: db, storage, logger: silentLogger });
    await expect(app.lifecycle.close()).resolves.toBeUndefined();
  });

  it("exposes the passed logger instance", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfRouter({ database: db, storage, logger: silentLogger });
    expect(app.lifecycle.logger).toBe(silentLogger);
  });

  it("defaults to a working logger when omitted", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfRouter({ database: db, storage });
    expect(typeof app.lifecycle.logger.info).toBe("function");
    expect(typeof app.lifecycle.logger.child).toBe("function");
  });

  it("init throws AdapterInitError naming the failed adapter", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const broken = {
      ...db,
      lifecycle: {
        init: async (): Promise<void> => {
          await Promise.resolve();
          throw new Error("db down");
        },
      },
    };
    const app = createShelfRouter({ database: broken, storage, logger: silentLogger });
    const failure = await app.lifecycle.init().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AdapterLifecycleError);
    const initError = failure as AdapterLifecycleError;
    expect(initError.phase).toBe("init");
    expect(initError.failures).toHaveLength(1);
    expect(initError.failures[0]?.category).toBe("database");
    expect(initError.message).toContain("database");
  });

  it("gates API requests with 503 after failed init", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const broken = {
      ...db,
      lifecycle: {
        init: async (): Promise<void> => {
          await Promise.resolve();
          throw new Error("db down");
        },
      },
    };
    const app = createShelfRouter({ database: broken, storage, logger: silentLogger });
    await app.lifecycle.ready;
    const response = await app.request("/api/v1/projects");
    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      error: string;
      failures: { category: string; kind: string }[];
    };
    expect(body.error).toContain("initialize");
    expect(body.failures[0]?.category).toBe("database");
  });
});

describe("health endpoints", () => {
  it("GET /api/v1/health answers liveness without auth or init", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfRouter({ database: db, storage, logger: silentLogger });
    const response = await app.request("/api/v1/health");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; uptimeSecs: number; version: string };
    expect(body.status).toBe("ok");
    expect(body.uptimeSecs).toBeGreaterThanOrEqual(0);
    expect(typeof body.version).toBe("string");
  });

  it("GET /api/v1/health stays 200 after failed init", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const broken = {
      ...db,
      lifecycle: {
        init: async (): Promise<void> => {
          await Promise.resolve();
          throw new Error("db down");
        },
      },
    };
    const app = createShelfRouter({ database: broken, storage, logger: silentLogger });
    await app.lifecycle.ready;
    const response = await app.request("/api/v1/health");
    expect(response.status).toBe(200);
  });

  it("POST /api/v1/health is open when auth is disabled", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfRouter({ database: db, storage, logger: silentLogger });
    await app.lifecycle.init();
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

  it("POST /api/v1/health reports init failures as degraded", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const broken = {
      ...db,
      lifecycle: {
        init: async (): Promise<void> => {
          await Promise.resolve();
          throw new Error("db down");
        },
      },
    };
    const app = createShelfRouter({ database: broken, storage, logger: silentLogger });
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
    const app = createShelfRouter({
      database: db,
      storage,
      auth: noSessionAuth,
      logger: silentLogger,
    });
    await app.lifecycle.init();
    const response = await app.request("/api/v1/health", { method: "POST" });
    expect(response.status).toBe(403);
  });

  it("POST /api/v1/health allows site admins", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfRouter({ database: db, storage, auth: adminAuth, logger: silentLogger });
    await app.lifecycle.init();
    const response = await app.request("/api/v1/health", { method: "POST" });
    expect(response.status).toBe(200);
  });
});
