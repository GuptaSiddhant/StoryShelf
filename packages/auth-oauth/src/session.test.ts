import type { AuthUser } from "@storyshelf/core/adapter/auth";
import { describe, expect, it } from "vitest";
import { createOAuthAuth } from "./index.ts";

const user: AuthUser = {
  id: "user_1",
  email: "ada@example.com",
  name: "Ada Lovelace",
  role: "member",
};

const options = {
  issuer: "https://id.example.com/realms/storyshelf",
  clientId: "client-id",
  clientSecret: "client-secret",
  secret: "signing-secret",
  redirectUrl: "https://storyshelf.example.com/api/v1/auth/callback",
};

function requestWithCookie(cookie: string): Request {
  return new Request("http://localhost/", {
    headers: { cookie: `storyshelf_session=${cookie}` },
  });
}

describe("session handlers", () => {
  it("round-trips a session through check", async () => {
    const auth = createOAuthAuth(options);
    const token = await auth.createSession(user);

    const result = await auth.check(requestWithCookie(token));
    expect(result).toEqual(user);
  });

  it("returns null when no session cookie is present", async () => {
    const auth = createOAuthAuth(options);
    await expect(auth.check(new Request("http://localhost/"))).resolves.toBeNull();
  });

  it("round-trips groups through the session", async () => {
    const auth = createOAuthAuth(options);
    const withGroups: AuthUser = { ...user, groups: ["team-a"] };
    const token = await auth.createSession(withGroups);
    expect(await auth.check(requestWithCookie(token))).toEqual(withGroups);
  });
});
