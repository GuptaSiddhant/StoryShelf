import type { AuthUser } from "@storyshelf/core/adapter/auth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOAuthAuth, type OAuthAuth } from "./index.ts";
import { cognitoPreset } from "./presets.ts";

const options = {
  issuer: "https://id.example.com/realms/storyshelf",
  clientId: "client-id",
  clientSecret: "client-secret",
  secret: "signing-secret",
  redirectUrl: "https://storyshelf.example.com/api/v1/auth/callback",
};

const basePresetOptions = {
  clientId: "client-id",
  clientSecret: "client-secret",
  secret: "signing-secret",
  redirectUrl: "https://storyshelf.example.com/api/v1/auth/callback",
};

function stubFetch(handler: (url: string) => unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      await Promise.resolve();
      return {
        ok: true,
        json: async (): Promise<unknown> => {
          await Promise.resolve();
          return handler(url);
        },
      };
    }),
  );
}

async function callback(auth: OAuthAuth): Promise<AuthUser | null> {
  return (await auth.handleCallback?.({ provider: "oidc", code: "c", state: "s" })) ?? null;
}

describe("login url", () => {
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

describe("handleCallback groups and roles", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts groups and maps adminGroups to admin", async () => {
    stubFetch((url) =>
      url.endsWith("/oauth2/token")
        ? { access_token: "at" }
        : { sub: "u1", email: "u@example.com", groups: ["team-a", "shelf-admins"] },
    );
    const auth = createOAuthAuth({
      ...cognitoPreset("us-east-1", "us-east-1_abc", basePresetOptions),
      adminGroups: ["shelf-admins"],
    });
    const signedIn = await callback(auth);
    expect(signedIn?.role).toBe("admin");
    expect(signedIn?.groups).toEqual(["team-a", "shelf-admins"]);
  });

  it("reads the cognito:groups alias", async () => {
    stubFetch((url) =>
      url.endsWith("/oauth2/token")
        ? { access_token: "at" }
        : { sub: "u1", email: "u@example.com", "cognito:groups": ["devs"] },
    );
    const auth = createOAuthAuth(cognitoPreset("us-east-1", "us-east-1_abc", basePresetOptions));
    const signedIn = await callback(auth);
    expect(signedIn?.groups).toEqual(["devs"]);
    expect(signedIn?.role).toBe("member");
  });

  it("maps viewerGroups to viewer", async () => {
    stubFetch((url) =>
      url.endsWith("/protocol/openid-connect/token")
        ? { access_token: "at" }
        : { sub: "u1", email: "u@example.com", groups: ["auditors"] },
    );
    const auth = createOAuthAuth({
      ...options,
      viewerGroups: ["auditors"],
      discoveryUrl: null,
    });
    const signedIn = await callback(auth);
    expect(signedIn?.role).toBe("viewer");
  });

  it("fails closed on Entra group overage", async () => {
    stubFetch((url) =>
      url.endsWith("/protocol/openid-connect/token")
        ? { access_token: "at" }
        : { sub: "u1", _claim_names: { groups: "src1" } },
    );
    const auth = createOAuthAuth({ ...options, discoveryUrl: null });
    await expect(callback(auth)).rejects.toThrow(/overage/u);
  });

  it("falls back to Keycloak endpoints when discovery is unreachable", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        await Promise.resolve();
        seen.push(url);
        if (url.includes(".well-known")) {
          return { ok: false, json: async () => ({}) };
        }
        if (url.endsWith("/protocol/openid-connect/token")) {
          return { ok: true, json: async () => ({ access_token: "at" }) };
        }
        return { ok: true, json: async () => ({ sub: "u1", email: "u@example.com" }) };
      }),
    );
    const auth = createOAuthAuth(options);
    const signedIn = await callback(auth);
    expect(signedIn?.id).toBe("u1");
    expect(seen.some((url) => url.includes(".well-known"))).toBe(true);
  });
});
