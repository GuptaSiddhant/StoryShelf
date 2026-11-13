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
    expect(header).toContain("db;dur=13");
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

  it("times c.html under render", async () => {
    const router = new Hono();
    router.use("*", serverTiming(true));
    router.get("/page", (c) => c.html("<p>hi</p>"));
    const header = (await router.request("/page")).headers.get("Server-Timing") ?? "";
    expect(header).toMatch(/render;dur=\d+, total;dur=\d+/u);
  });

  it("emits phase names and durations only", async () => {
    const router = new Hono();
    router.use("*", serverTiming(true));
    router.get("/p/secret-id", (c) => {
      addTiming("storage", 1);
      addTiming("db.query SELECT 1 /p/secret-id", 9);
      return c.json({ ok: true });
    });
    const header =
      (await router.request("/p/secret-id?q=token")).headers.get("Server-Timing") ?? "";
    expect(header).toMatch(/^storage;dur=1, total;dur=\d+$/u);
  });

  it("leaves published, signed, asset and non-page answers alone", async () => {
    const router = new Hono();
    router.use("*", serverTiming(true));
    const paths = ["/_/abc/index.html", "/_s/tok/index.html", "/_r/tok/x", "/assets/a.html"];
    for (const path of paths) {
      router.get(path, (c) => c.html("<p>x</p>"));
    }
    router.get("/file.css", (c) => c.body("a{}", 200, { "Content-Type": "text/css" }));
    const all = [...paths, "/file.css"];
    const headers: (string | null)[] = [];
    for (const path of all) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential, tiny
      headers.push((await router.request(path)).headers.get("Server-Timing"));
    }
    expect(headers).toEqual(all.map(() => null));
  });

  it("is compatible with compressed answers", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const shelf = createShelfApp({
      database: db,
      storage,
      logger: pino({ level: "silent" }),
      config: { serverTiming: true },
    });
    const res = await shelf.request("/api/v1/health", { headers: { "Accept-Encoding": "gzip" } });
    expect(res.headers.get("Server-Timing")).toContain("total;");
    expect((await res.json()) as unknown).toBeTruthy();
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
