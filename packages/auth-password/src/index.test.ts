import type { AuthUser } from "@storyshelf/core/adapter/auth";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPasswordAuth } from "./index.ts";

const user: AuthUser = {
  id: "user_1",
  email: "ada@example.com",
  name: "Ada Lovelace",
  avatarUrl: "https://example.com/ada.png",
  role: "admin",
};

const secret = "signing-secret";

function requestWithCookie(cookie: string): Request {
  return new Request("http://localhost/", {
    headers: { cookie: `storyshelf_session=${cookie}` },
  });
}

function expiredToken(): string {
  const payload = {
    userId: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: user.role,
    expiresAt: Date.now() - 1000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  return `${body}.${signature}`;
}

describe("createPasswordAuth", () => {
  it("round-trips a session through check", async () => {
    const auth = createPasswordAuth({ password: "hunter2", secret });
    const token = await auth.createSession(user);

    const result = await auth.check(requestWithCookie(token));
    expect(result).toEqual(user);
  });

  it("returns null when no session cookie is present", async () => {
    const auth = createPasswordAuth({ password: "hunter2", secret });
    await expect(auth.check(new Request("http://localhost/"))).resolves.toBeNull();
  });
  it("rejects a tampered token", async () => {
    const auth = createPasswordAuth({ password: "hunter2", secret });
    const token = await auth.createSession(user);
    // Flip the last hex digit (guaranteed to change it, unlike a fixed replacement).
    const tampered = `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;

    await expect(auth.check(requestWithCookie(tampered))).resolves.toBeNull();
  });

  it("rejects an expired token", async () => {
    const auth = createPasswordAuth({ password: "hunter2", secret });
    const request = requestWithCookie(expiredToken());

    await expect(auth.check(request)).resolves.toBeNull();
  });

  it("login returns a token for the correct password", async () => {
    const auth = createPasswordAuth({ password: "hunter2", secret });
    const token = await auth.login("hunter2", user);

    await expect(auth.check(requestWithCookie(token))).resolves.toEqual(user);
  });

  it("login rejects the wrong password", async () => {
    const auth = createPasswordAuth({ password: "hunter2", secret });
    await expect(auth.login("wrong", user)).rejects.toThrow();
  });

  it("destroySession resolves without error", async () => {
    const auth = createPasswordAuth({ password: "hunter2", secret });
    await expect(auth.destroySession("ignored")).resolves.toBeUndefined();
  });
});
