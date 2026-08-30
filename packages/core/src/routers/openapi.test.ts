import { describe, expect, it } from "vitest";
import { pino } from "pino";

import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { createShelfRouter } from "../index.tsx";

const silentLogger = pino({ level: "silent" });

const fail = async (): Promise<never> => {
  return await Promise.reject(new Error("not used in this test"));
};

function stubDatabase(): DatabaseAdapter {
  return {
    insert: fail,
    update: fail,
    get: fail,
    remove: fail,
    list: fail,
    count: fail,
    all: fail,
    migrate: fail,
    close: fail,
  };
}

function stubStorage(): StorageAdapter {
  return {
    read: fail,
    write: fail,
    delete: fail,
    exists: fail,
    list: fail,
  };
}

function app(): ReturnType<typeof createShelfRouter> {
  return createShelfRouter({
    database: stubDatabase(),
    storage: stubStorage(),
    logger: silentLogger,
  });
}

interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, unknown>;
}

describe("OpenAPI spec", () => {
  it("serves a draft-valid OpenAPI v3 document at /api/v1/openapi.json", async () => {
    const response = await app().request("/api/v1/openapi.json");
    expect(response.status).toBe(200);
    const doc = (await response.json()) as OpenApiDocument;
    expect(doc.openapi).toBe("3.0.0");
    expect(doc.info.title).toBe("StoryShelf API");
    expect(doc.paths["/api/v1/projects"]).toBeDefined();
    expect(doc.paths["/api/v1/projects/{slug}/builds"]).toBeDefined();
    expect(doc.paths["/api/v1/admin/purge"]).toBeDefined();
  });

  it("documents project paths with typed responses", async () => {
    const response = await app().request("/api/v1/openapi.json");
    const doc = (await response.json()) as OpenApiDocument;
    const paths = doc.paths as Record<string, { get?: { responses: Record<string, unknown> }; post?: unknown }>;
    expect(paths["/api/v1/projects"]?.get?.responses["200"]).toBeDefined();
    expect(paths["/api/v1/projects/{slug}"]?.get?.responses["200"]).toBeDefined();
  });

  it("serves an interactive docs page at /api/v1/docs", async () => {
    const response = await app().request("/api/v1/docs");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("/api/v1/openapi.json");
  });
});