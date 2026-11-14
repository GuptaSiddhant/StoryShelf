import { stubTables } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";

const fail = async (): Promise<never> => await Promise.reject(new Error("not used"));

function makeApp(): ReturnType<typeof createShelfApp> {
  return createShelfApp({
    database: {
      metadata: { name: "Stub DB", version: "0.0.0", kind: "stub", category: "database" },
      tables: stubTables(),
      insert: fail,
      update: fail,
      updateWhere: fail,
      get: fail,
      remove: fail,
      list: fail,
      count: fail,
      all: fail,
    },
    storage: {
      metadata: { name: "Stub Storage", version: "0.0.0", kind: "stub", category: "storage" },
      read: fail,
      write: fail,
      delete: fail,
      exists: fail,
      list: fail,
      writeStream: fail,
      readStream: fail,
    },
    logger: pino({ level: "silent" }),
  });
}

describe("GET /sw.js", () => {
  it("serves the worker as revalidated JavaScript without Service-Worker-Allowed", async () => {
    const res = await makeApp().request("/sw.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.has("service-worker-allowed")).toBe(false);
    expect(await res.text()).toContain("addEventListener('fetch'");
  });

  it("never sends Service-Worker-Allowed from published-file routes", async () => {
    const app = makeApp();
    const paths = [
      "/projects/demo/storybook",
      "/projects/demo/storybook/main/sw.js",
      "/_s/x/sw.js",
      "/_r/x/sw.js",
    ];
    const responses = await Promise.all(paths.map(async (path) => await app.request(path)));
    expect(responses.map((res) => res.headers.has("service-worker-allowed"))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});
