import type { AuthUser } from "@storyshelf/core/adapter/auth";
import { createMultiAuth } from "@storyshelf/core/adapter/multi-auth";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";

const silentLogger = pino({ level: "silent" });

const ssoUser: AuthUser = { id: "u1", email: "u@example.com", name: "U", role: "member" };

function stubSso(): AuthAdapter & { loginUrl(state: string): string } {
  return {
    metadata: { name: "Stub SSO", version: "0.0.0", kind: "oauth", category: "auth" },
    check: async () => null,
    createSession: async () => "ok",
    destroySession: async () => {},
    loginUrl: (state: string) => `https://provider.example.com/authorize?state=${state}`,
    handleCallback: async () => ssoUser,
  };
}

type AuthAdapter = import("@storyshelf/core/adapter/auth").AuthAdapter;

function testApp(auth: AuthAdapter, publicBaseUrl?: string): ReturnType<typeof createShelfApp> {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  return createShelfApp({
    database: db,
    storage,
    auth,
    logger: silentLogger,
    config: { secret: "test-secret", ...(publicBaseUrl ? { publicBaseUrl } : {}) },
  });
}

function composite(): AuthAdapter {
  return createMultiAuth({
    secret: "test-secret",
    methods: [
      { id: "keycloak", label: "Keycloak", adapter: stubSso() },
      { id: "github", label: "GitHub", adapter: stubSso() },
    ],
  });
}

describe("well-known relying-party documents", () => {
  it("serves the RP helper document without a session", async () => {
    const response = await testApp(composite()).request("/.well-known/openid-configuration");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as {
      issuer: string;
      redirect_uris: string[];
      providers: Array<{ id: string; label: string }>;
      response_types_supported: string[];
    };
    expect(body.issuer).toBe("http://localhost");
    expect(body.response_types_supported).toEqual(["code"]);
    expect(body.redirect_uris).toEqual([
      "http://localhost/auth/callback/keycloak",
      "http://localhost/auth/callback/github",
    ]);
    expect(body.providers).toEqual([
      { id: "keycloak", label: "Keycloak" },
      { id: "github", label: "GitHub" },
    ]);
  });

  it("prefers publicBaseUrl as the issuer", async () => {
    const response = await testApp(composite(), "https://shelf.example.com").request(
      "/.well-known/openid-configuration",
    );
    const body = (await response.json()) as { issuer: string; redirect_uris: string[] };
    expect(body.issuer).toBe("https://shelf.example.com");
    expect(body.redirect_uris).toEqual([
      "https://shelf.example.com/auth/callback/keycloak",
      "https://shelf.example.com/auth/callback/github",
    ]);
  });

  it("uses the legacy callback route for a single provider", async () => {
    const response = await testApp(stubSso()).request("/.well-known/openid-configuration");
    const body = (await response.json()) as { redirect_uris: string[] };
    expect(body.redirect_uris).toEqual(["http://localhost/auth/callback"]);
  });

  it("redirects change-password to the profile page", async () => {
    const response = await testApp(composite()).request("/.well-known/change-password");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/profile");
  });
});
