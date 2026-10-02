import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";

const silentLogger = pino({ level: "silent" });

const dbFail = async (): Promise<never> => {
  return await Promise.reject(new Error("database not used in this test"));
};

const storageFail = async (): Promise<never> => {
  return await Promise.reject(new Error("storage not used in this test"));
};

function stubTables(): DatabaseAdapter["tables"] {
  const tables: Record<string, unknown> = {};
  for (const key of [
    "projects",
    "builds",
    "snapshots",
    "baselines",
    "comments",
    "labelTypes",
    "buildLabels",
    "tokens",
    "webhooks",
    "users",
    "projectMembers",
  ]) {
    tables[key] = {};
  }
  return tables as unknown as DatabaseAdapter["tables"];
}

function stubDatabase(): DatabaseAdapter {
  return {
    metadata: { name: "Stub DB", version: "0.0.0", kind: "stub", category: "database" },
    tables: stubTables(),
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

const noSessionAuth = stubAuth(null);

describe("static assets", () => {
  it("serves htmx.js with a JavaScript content type and immutable cache header", async () => {
    const app = createShelfApp({
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
    const app = createShelfApp({
      database: stubDatabase(),
      storage: stubStorage(),
      logger: silentLogger,
    });
    const body = await (await app.request("/assets/htmx.js")).text();
    expect(body.length).toBeGreaterThan(1000);
    expect(body).toContain("htmx");
  });

  it("does not gate assets behind the UI auth redirect", async () => {
    const app = createShelfApp({
      database: stubDatabase(),
      storage: stubStorage(),
      auth: noSessionAuth,
      logger: silentLogger,
    });
    const response = await app.request("/assets/htmx.js");
    expect(response.status).toBe(200);
  });
});
