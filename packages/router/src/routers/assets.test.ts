import type { AuthAdapter } from "@storyshelf/core/adapter/auth";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfRouter } from "../index.tsx";

const silentLogger = pino({ level: "silent" });

const dbFail = async (): Promise<never> => {
  return await Promise.reject(new Error("database not used in this test"));
};

const storageFail = async (): Promise<never> => {
  return await Promise.reject(new Error("storage not used in this test"));
};

function stubDatabase(): DatabaseAdapter {
  return {
    metadata: { name: "Stub DB", version: "0.0.0", kind: "stub", category: "database" },
    insert: dbFail,
    update: dbFail,
    get: dbFail,
    remove: dbFail,
    list: dbFail,
    count: dbFail,
    all: dbFail,
  };
}

function stubStorage(): StorageAdapter {
  return {
    metadata: { name: "Stub Storage", version: "0.0.0", kind: "stub", category: "storage" },
    read: storageFail,
    write: storageFail,
    delete: storageFail,
    exists: storageFail,
    list: storageFail,
    writeStream: storageFail,
    readStream: storageFail,
  };
}

const noSessionAuth: AuthAdapter = {
  metadata: { name: "Stub Auth", version: "0.0.0", kind: "stub", category: "auth" },
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

describe("static assets", () => {
  it("serves htmx.js with a JavaScript content type and immutable cache header", async () => {
    const app = createShelfRouter({
      database: stubDatabase(),
      storage: stubStorage(),
      logger: silentLogger,
    });
    const response = await app.request("/assets/htmx.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/javascript");
    expect(response.headers.get("cache-control")).toContain("immutable");
  });

  it("serves the vendored htmx payload", async () => {
    const app = createShelfRouter({
      database: stubDatabase(),
      storage: stubStorage(),
      logger: silentLogger,
    });
    const body = await (await app.request("/assets/htmx.js")).text();
    expect(body.length).toBeGreaterThan(1000);
    expect(body).toContain("htmx");
  });

  it("does not gate assets behind the UI auth redirect", async () => {
    const app = createShelfRouter({
      database: stubDatabase(),
      storage: stubStorage(),
      auth: noSessionAuth,
      logger: silentLogger,
    });
    const response = await app.request("/assets/htmx.js");
    expect(response.status).toBe(200);
  });
});
