import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { csrf, getCsrfToken } from "./csrf.ts";

/** Minimal app guarding a write path with the CSRF middleware. */
function app(secret?: string): Hono {
  const router = new Hono();
  router.use("/protected/*", csrf(secret));
  router.get("/protected/page", (c) => c.text("ok"));
  router.post("/protected/page", (c) => c.text("ok"));
  return router;
}

describe("csrf", () => {
  it("rejects a write without a token", async () => {
    const res = await app("test-secret").request("/protected/page", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("accepts a write carrying a token minted for the same secret", async () => {
    const token = getCsrfToken("test-secret");
    const res = await app("test-secret").request("/protected/page", {
      method: "POST",
      headers: { "x-csrf-token": token },
    });
    expect(res.status).toBe(200);
  });

  it("rejects a token minted for a different secret", async () => {
    const token = getCsrfToken("other-secret");
    const res = await app("test-secret").request("/protected/page", {
      method: "POST",
      headers: { "x-csrf-token": token },
    });
    expect(res.status).toBe(403);
  });

  it("issues a token on safe methods", async () => {
    const res = await app("test-secret").request("/protected/page");
    expect(res.headers.get("x-csrf-token")).toBeTruthy();
  });
});
