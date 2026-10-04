import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { addTiming } from "@storyshelf/core/utils";
import { Hono } from "hono";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { serverTiming } from "./server-timing.ts";

function app(enabled: boolean): Hono {
  const router = new Hono();
  router.use("*", serverTiming(enabled));
  router.get("/work", (c) => {
    addTiming("db", 12.5);
    return c.json({ ok: true });
  });
  return router;
}

describe("serverTiming", () => {
  it("emits total plus recorded aggregates when enabled", async () => {
    const response = await app(true).request("/work");
    const header = response.headers.get("Server-Timing") ?? "";
    expect(header).toContain("total;");
    expect(header).toContain("db;dur=12.5");
  });

  it("emits no header when disabled", async () => {
    const response = await app(false).request("/work");
    expect(response.headers.get("Server-Timing")).toBeNull();
  });

  it("still emits total when nothing was recorded", async () => {
    const router = new Hono();
    router.use("*", serverTiming(true));
    router.get("/idle", (c) => c.json({ ok: true }));
    const header = (await router.request("/idle")).headers.get("Server-Timing") ?? "";
    expect(header).toContain("total;");
    expect(header).not.toContain("db;");
  });

  it("wires the ShelfConfig flag through createShelfApp", async () => {
    const silent = pino({ level: "silent" });
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const enabled = createShelfApp({
      database: db,
      storage,
      logger: silent,
      config: { serverTiming: true },
    });
    const header = (await enabled.request("/api/v1/health")).headers.get("Server-Timing") ?? "";
    expect(header).toContain("total;");

    const disabled = createShelfApp({ database: db, storage, logger: silent });
    expect((await disabled.request("/api/v1/health")).headers.get("Server-Timing")).toBeNull();
  });
});
