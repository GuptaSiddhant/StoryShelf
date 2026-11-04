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

/** Status of a write to the guarded path with the given cookie header and token. */
async function send(cookie: string, csrfToken: string): Promise<number> {
  const res = await app("test-secret").request("/protected/page", {
    method: "POST",
    headers: { cookie, "x-csrf-token": csrfToken },
  });
  return res.status;
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

  it("binds the token to the __Secure- session cookie used over https", async () => {
    const secure = "__Secure-storyshelf_session";
    const token = getCsrfToken("test-secret", "session-a");
    expect(await send(`${secure}=session-a`, token)).toBe(200);
    // Another session's token is refused, and so is the anonymous one.
    expect(await send(`${secure}=session-b`, token)).toBe(403);
    expect(await send(`${secure}=session-a`, getCsrfToken("test-secret"))).toBe(403);
  });

  it("rejects a token minted for another session", async () => {
    const token = getCsrfToken("test-secret", "session-a");
    const res = await app("test-secret").request("/protected/page", {
      method: "POST",
      headers: { cookie: "storyshelf_session=session-b", "x-csrf-token": token },
    });
    expect(res.status).toBe(403);
  });

  it("accepts a token minted for the request session", async () => {
    const token = getCsrfToken("test-secret", "session-a");
    const res = await app("test-secret").request("/protected/page", {
      method: "POST",
      headers: { cookie: "storyshelf_session=session-a", "x-csrf-token": token },
    });
    expect(res.status).toBe(200);
  });

  it("issues a token on safe methods", async () => {
    const res = await app("test-secret").request("/protected/page");
    expect(res.headers.get("x-csrf-token")).toBeTruthy();
  });

  it("accepts a token submitted in the form body (native fallback)", async () => {
    const token = getCsrfToken("test-secret");
    const res = await app("test-secret").request("/protected/page", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf_token: token }).toString(),
    });
    expect(res.status).toBe(200);
  });

  it("rejects a form body without a token", async () => {
    const res = await app("test-secret").request("/protected/page", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name: "x" }).toString(),
    });
    expect(res.status).toBe(403);
  });
});
