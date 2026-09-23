import type { AuthUser } from "@storyshelf/core/adapter/auth";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSessionHandlers, SESSION_TTL_MS } from "./session.ts";

const user: AuthUser = {
  id: "user_1",
  email: "ada@example.com",
  name: "Ada Lovelace",
  avatarUrl: "https://example.com/ada.png",
  role: "admin",
};

const userNoAvatar: AuthUser = {
  id: "user_2",
  email: "bob@example.com",
  name: "Bob",
  role: "viewer",
};

const secret = "signing-secret";

function cookieRequest(value?: string, extraCookies = ""): Request {
  if (value) {
    const cookie = `storyshelf_session=${value}${extraCookies}`;
    return new Request("http://localhost/", { headers: { cookie } });
  }
  if (extraCookies) return new Request("http://localhost/", { headers: { cookie: extraCookies } });
  return new Request("http://localhost/");
}

describe("createSessionHandlers", () => {
  it("round-trips a session with avatarUrl", async () => {
    const { createSession, check } = createSessionHandlers(secret);
    const token = await createSession(user);
    expect(await check(cookieRequest(token))).toEqual(user);
  });

  it("round-trips without avatarUrl", async () => {
    const { createSession, check } = createSessionHandlers(secret);
    const token = await createSession(userNoAvatar);
    expect(await check(cookieRequest(token))).toEqual(userNoAvatar);
  });

  it("returns null when no cookie present", async () => {
    const { check } = createSessionHandlers(secret);
    await expect(check(cookieRequest())).resolves.toBeNull();
  });

  it("parses multi-cookie header correctly", async () => {
    const { createSession, check } = createSessionHandlers(secret);
    const token = await createSession(user);
    const header = `other=1; storyshelf_session=${token}; another=2`;
    const req = new Request("http://localhost/", { headers: { cookie: header } });
    expect(await check(req)).toEqual(user);
  });

  it("rejects token with no dot", async () => {
    const { check } = createSessionHandlers(secret);
    await expect(check(cookieRequest("nodot-token"))).resolves.toBeNull();
  });

  it("rejects token with invalid base64 payload", async () => {
    const badBody = "!!!not-base64!!!";
    const sig = createHmac("sha256", secret).update(badBody).digest("hex");
    await expect(
      createSessionHandlers(secret).check(cookieRequest(`${badBody}.${sig}`)),
    ).resolves.toBeNull();
  });

  it("rejects tampered signature", async () => {
    const { createSession, check } = createSessionHandlers(secret);
    const token = await createSession(user);
    const tampered = `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;
    await expect(check(cookieRequest(tampered))).resolves.toBeNull();
  });

  it("rejects expired token", async () => {
    const payload = {
      userId: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: user.role,
      expiresAt: Date.now() - 1000,
    };
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    const token = `${body}.${sig}`;
    await expect(createSessionHandlers(secret).check(cookieRequest(token))).resolves.toBeNull();
  });

  it("SESSION_TTL_MS is 7 days", () => {
    expect(SESSION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
