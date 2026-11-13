import { Hono } from "hono";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { compression } from "./compression.ts";

const BIG = "x".repeat(4000);

function app(): Hono {
  const a = new Hono();
  a.use("*", compression());
  a.get("/page", (c) => c.html(`<p>${BIG}</p>`));
  a.get("/small", (c) => c.html("<p>hi</p>"));
  a.get("/api/v1/x", (c) => c.json({ v: BIG }));
  a.get("/api/v1/tokens/new", (c) => c.json({ token: BIG }));
  a.get("/auth/login", (c) => c.html(BIG));
  a.get("/_s/t/index.html", (c) => c.html(BIG));
  a.get("/_/id/f.js", (c) => c.body(BIG, 200, { "content-type": "text/javascript" }));
  a.get("/css", (c) => c.body(BIG, 200, { "content-type": "text/css" }));
  a.get("/cookie", (c) => {
    c.header("Set-Cookie", "a=b");
    return c.html(BIG);
  });
  a.get("/gz", (c) => c.body(BIG, 200, { "content-type": "text/html", "content-encoding": "br" }));
  return a;
}

const get = async (path: string, enc = "gzip") =>
  await app().request(path, { headers: { "accept-encoding": enc } });

describe("compression", () => {
  it.each(["/page", "/api/v1/x"])("gzips large answers at %s and sets Vary", async (path) => {
    const res = await get(path);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("vary")).toContain("Accept-Encoding");
    expect(gunzipSync(Buffer.from(await res.arrayBuffer())).toString()).toContain(BIG);
  });

  it("leaves small answers, other types and clients without gzip alone", async () => {
    expect((await get("/small")).headers.get("content-encoding")).toBeNull();
    expect((await get("/css")).headers.get("content-encoding")).toBeNull();
    expect((await get("/page", "identity")).headers.get("content-encoding")).toBeNull();
  });

  it.each(["/_s/t/index.html", "/_/id/f.js", "/auth/login", "/api/v1/tokens/new", "/cookie"])(
    "never compresses %s",
    async (path) => {
      const res = await get(path);
      expect(res.headers.get("content-encoding")).toBeNull();
      expect((await res.text()).length).toBeGreaterThan(3000);
    },
  );

  it("keeps an existing Content-Encoding", async () => {
    expect((await get("/gz")).headers.get("content-encoding")).toBe("br");
  });
});
