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
    // The token comes from a safe-method response for that cookie, so generation is covered too.
    const page = await app("test-secret").request("/protected/page", {
      headers: { cookie: `${secure}=session-a` },
    });
    const token = page.headers.get("x-csrf-token") ?? "";
    expect(token).not.toBe("");
    expect(await send(`${secure}=session-a`, token)).toBe(200);
    // Another session's token is refused, and so is the anonymous one.
    expect(await send(`${secure}=session-b`, token)).toBe(403);
    expect(await send(`${secure}=session-a`, getCsrfToken("test-secret"))).toBe(403);
  });

  it.each(["storyshelf_session", "__Secure-storyshelf_session"])(
    "does not put the value of the %s cookie in the token",
    async (name) => {
      const cookie = `${name}=secret-session.sig`;
      const page = await app("test-secret").request("/protected/page", { headers: { cookie } });
      const token = page.headers.get("x-csrf-token") ?? "";
      expect(token).not.toContain("secret-session");
      expect(token).not.toContain("sig");
      expect(await send(cookie, token)).toBe(200);
    },
  );

  it("does not put the session id in a token minted directly either", () => {
    expect(getCsrfToken("test-secret", "secret-session.sig")).not.toContain("secret-session");
  });

  it("still accepts a token in the earlier format that began with the session id", async () => {
    const current = getCsrfToken("test-secret", "session-a");
    const [, timestamp, signature] = current.split(":");
    const legacy = `session-a:${timestamp}:${signature}`;
    expect(await send("storyshelf_session=session-a", legacy)).toBe(200);
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
