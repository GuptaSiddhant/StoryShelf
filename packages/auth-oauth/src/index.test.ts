import type { AuthUser } from "@storyshelf/core/adapter/auth";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  auth0Preset,
  cognitoPreset,
  createOAuthAuth,
  entraPreset,
  keycloakPreset,
  oktaPreset,
  type OAuthAuth,
} from "./index.ts";

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

const basePresetOptions = {
  clientId: "client-id",
  clientSecret: "client-secret",
  secret: "signing-secret",
  redirectUrl: "https://storyshelf.example.com/api/v1/auth/callback",
};

describe("provider presets", () => {
  it("keycloakPreset keeps the realm issuer", () => {
    const preset = keycloakPreset("https://id.example.com/realms/team", basePresetOptions);
    expect(preset.issuer).toBe("https://id.example.com/realms/team");
    expect(preset.authorizationEndpoint).toBeUndefined();
  });

  it("oktaPreset builds v1 endpoints", () => {
    const preset = oktaPreset("id.example.okta.com", "default", basePresetOptions);
    expect(preset.issuer).toBe("https://id.example.okta.com/oauth2/default");
    expect(preset.tokenEndpoint).toBe("https://id.example.okta.com/oauth2/default/v1/token");
  });

  it("entraPreset builds tenant endpoints", () => {
    const preset = entraPreset("tenant-id", basePresetOptions);
    expect(preset.issuer).toBe("https://login.microsoftonline.com/tenant-id/v2.0");
    expect(preset.userinfoEndpoint).toBe("https://graph.microsoft.com/oidc/userinfo");
  });

  it("cognitoPreset builds pool endpoints", () => {
    const preset = cognitoPreset("us-east-1", "us-east-1_abc", basePresetOptions);
    expect(preset.issuer).toBe("https://cognito-idp.us-east-1.amazonaws.com/us-east-1_abc");
    expect(preset.tokenEndpoint).toBe(
      "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_abc/oauth2/token",
    );
  });

  it("auth0Preset builds domain endpoints", () => {
    const preset = auth0Preset("tenant.us.auth0.com", basePresetOptions);
    expect(preset.tokenEndpoint).toBe("https://tenant.us.auth0.com/oauth/token");
  });

  it("preset endpoints flow into the login url", () => {
    const auth = createOAuthAuth(entraPreset("tenant-id", basePresetOptions));
    const url = new URL(auth.loginUrl("s"));
    expect(url.hostname).toBe("login.microsoftonline.com");
    expect(url.pathname).toBe("/tenant-id/oauth2/v2.0/authorize");
  });
});

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

  it("round-trips groups through the session", async () => {
    const auth = createOAuthAuth(options);
    const withGroups: AuthUser = { ...user, groups: ["team-a"] };
    const token = await auth.createSession(withGroups);
    expect(await auth.check(requestWithCookie(token))).toEqual(withGroups);
  });
});
