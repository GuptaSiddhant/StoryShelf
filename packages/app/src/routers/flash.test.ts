import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { FLASH_COOKIE, flash, flashHx } from "./flash.ts";

function app(): Hono {
  const hono = new Hono();
  hono.get("/ui", (c) => {
    flash(c, "Saved ✓", "warning");
    return c.text("ok");
  });
  hono.get("/long", (c) => {
    flash(c, "x".repeat(500));
    return c.text("ok");
  });
  hono.get("/api", (c) => {
    flashHx(c, "Queued");
    return c.text("ok");
  });
  return hono;
}

function decode(setCookieHeader: string | null): { message: string; tone: string } {
  const value = /storyshelf_flash=([^;]+)/u.exec(setCookieHeader ?? "")?.[1] ?? "";
  return JSON.parse(decodeURIComponent(value));
}

describe("flash", () => {
  it("sets a short-lived, path-wide cookie carrying message and tone", async () => {
    const response = await app().request("/ui");
    const header = response.headers.get("set-cookie");
    expect(header).toContain(`${FLASH_COOKIE}=`);
    expect(header).toContain("Max-Age=60");
    expect(header).toContain("Path=/");
    expect(header).not.toContain("HttpOnly");
    expect(decode(header)).toEqual({ message: "Saved ✓", tone: "warning" });
  });

  it("truncates very long messages", async () => {
    const { message } = decode((await app().request("/long")).headers.get("set-cookie"));
    expect(message.length).toBeLessThanOrEqual(140);
    expect(message.endsWith("…")).toBe(true);
  });

  it("flashHx only sets the cookie for HTMX requests", async () => {
    const plain = await app().request("/api");
    const htmx = await app().request("/api", { headers: { "HX-Request": "true" } });
    expect(plain.headers.get("set-cookie")).toBeNull();
    expect(decode(htmx.headers.get("set-cookie")).message).toBe("Queued");
  });
});
