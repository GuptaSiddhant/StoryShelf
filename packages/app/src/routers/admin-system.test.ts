import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";

const silentLogger = pino({ level: "silent" });

function sessionAuth(role: "admin" | "member") {
  const user = { id: "user_1", email: "ada@example.com", name: "Ada", role };
  return {
    metadata: { name: "Stub Auth", version: "0.0.0", kind: "stub", category: "auth" as const },
    check: async () => {
      await Promise.resolve();
      return user;
    },
    createSession: async () => {
      await Promise.resolve();
      return "ok";
    },
    destroySession: async (): Promise<void> => {
      await Promise.resolve();
    },
  };
}

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

describe("admin system page", () => {
  it("is open with adapter rows when auth is disabled", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({ database: db, storage, logger: silentLogger });
    await app.lifecycle.setup();
    const response = await app.request("/admin");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("System");
    expect(html).toContain("database");
    expect(html).toContain("storage");
    expect(html).toContain('href="/admin"');
  });

  it("forbids non-admin members when auth is enabled", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({
      database: db,
      storage,
      auth: sessionAuth("member"),
      logger: silentLogger,
    });
    await app.lifecycle.setup();
    const response = await app.request("/admin");
    expect(response.status).toBe(403);
  });

  it("allows site admins and shows the version", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({
      database: db,
      storage,
      auth: sessionAuth("admin"),
      logger: silentLogger,
    });
    await app.lifecycle.setup();
    const response = await app.request("/admin");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Adapters");
    expect(html).toContain("0.0.0");
  });

  it("hides the sidebar link from non-admin members", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({
      database: db,
      storage,
      auth: sessionAuth("member"),
      logger: silentLogger,
    });
    await app.lifecycle.setup();
    const html = await (await app.request("/projects")).text();
    expect(html).not.toContain('href="/admin"');
  });

  it("surfaces setup failures as failed rows", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const broken = { ...db, lifecycle: brokenLifecycle("db down") };
    const app = createShelfApp({ database: broken, storage, logger: silentLogger });
    await app.lifecycle.ready;
    const response = await app.request("/admin");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("failed");
    expect(html).toContain("db down");
  });

  it("never leaks secret or admin token values", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({
      database: db,
      storage,
      logger: silentLogger,
      config: { secret: "s3cr3t-value", adminToken: "admintoken-value" },
    });
    await app.lifecycle.setup();
    const html = await (await app.request("/admin")).text();
    expect(html).not.toContain("s3cr3t-value");
    expect(html).not.toContain("admintoken-value");
  });
});
