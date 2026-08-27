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

describe("createOAuthAuth", () => {
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

  it("builds a login url with the expected query parameters", () => {
    const auth = createOAuthAuth(options);
    const url = new URL(auth.loginUrl("state-123"));

    expect(url.pathname).toBe("/realms/storyshelf/protocol/openid-connect/auth");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(options.redirectUrl);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("state-123");
  });

  it("honors custom scopes in the login url", () => {
    const auth = createOAuthAuth({ ...options, scopes: ["openid", "profile"] });
    const url = new URL(auth.loginUrl("state-123"));

    expect(url.searchParams.get("scope")).toBe("openid profile");
  });
});
