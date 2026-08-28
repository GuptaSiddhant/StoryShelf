import { describe, expect, it } from "vitest";

import type { AuthAdapter } from "../adapters/auth.ts";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { createShelfRouter } from "../index.tsx";

const dbFail = async (): Promise<never> => {
  return await Promise.reject(new Error("database not used in this test"));
};

const storageFail = async (): Promise<never> => {
  return await Promise.reject(new Error("storage not used in this test"));
};

function stubDatabase(): DatabaseAdapter {
  return {
    insert: dbFail,
    update: dbFail,
    get: dbFail,
    remove: dbFail,
    list: dbFail,
    count: dbFail,
    all: dbFail,
    migrate: dbFail,
    close: dbFail,
  };
}

function stubStorage(): StorageAdapter {
  return {
    read: storageFail,
    write: storageFail,
    delete: storageFail,
    exists: storageFail,
    list: storageFail,
  };
}

const noSessionAuth: AuthAdapter = {
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
    const app = createShelfRouter({ database: stubDatabase(), storage: stubStorage() });
    const response = await app.request("/assets/htmx.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/javascript");
    expect(response.headers.get("cache-control")).toContain("immutable");
  });

  it("serves the vendored htmx payload", async () => {
    const app = createShelfRouter({ database: stubDatabase(), storage: stubStorage() });
    const body = await (await app.request("/assets/htmx.js")).text();
    expect(body.length).toBeGreaterThan(1000);
    expect(body).toContain("htmx");
  });

  it("does not gate assets behind the UI auth redirect", async () => {
    const app = createShelfRouter({ database: stubDatabase(), storage: stubStorage(), auth: noSessionAuth });
    const response = await app.request("/assets/htmx.js");
    expect(response.status).toBe(200);
  });
});