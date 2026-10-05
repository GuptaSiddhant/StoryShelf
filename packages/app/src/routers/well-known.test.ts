import { createShelfAuth, samlPreset } from "@storyshelf/auth";
import { makeStorage } from "@storyshelf/core/test-helpers";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";

const silentLogger = pino({ level: "silent" });
const BASE_URL = "http://localhost:3000";

async function testApp() {
  const db = createSqliteDatabase(":memory:");
  await db.lifecycle?.setup({ config: {}, logger: silentLogger });
  const shelf = createShelfAuth({
    db,
    secret: "spike-secret-that-is-long-enough-123456",
    baseURL: BASE_URL,
    oauth: [
      {
        id: "keycloak",
        label: "Keycloak",
        clientId: "storyshelf",
        clientSecret: "shh",
        authorizationUrl: "https://idp.example.com/auth",
        tokenUrl: "https://idp.example.com/token",
        userInfoUrl: "https://idp.example.com/userinfo",
      },
    ],
    sso: {
      providers: [
        samlPreset({
          id: "acme-saml",
          label: "Acme",
          domain: "example.com",
          issuer: BASE_URL,
          entryPoint: "https://idp.example.com/sso",
          cert: "FAKE-CERT",
          entityID: "https://idp.example.com/metadata",
        }),
      ],
    },
  });
  const { storage } = makeStorage();
  return createShelfApp({ database: db, storage, auth: shelf.adapter, logger: silentLogger });
}

describe("well-known relying-party documents", () => {
  it("serves the RP helper document without a session", async () => {
    const response = await (await testApp()).request("/.well-known/openid-configuration");
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
      "http://localhost/api/auth/callback/keycloak",
      "http://localhost/api/auth/sso/callback/acme-saml",
      "http://localhost/api/auth/sso/saml2/sp/acs/acme-saml",
    ]);
    expect(body.providers).toEqual([
      { id: "keycloak", label: "Keycloak" },
      { id: "acme-saml", label: "Acme" },
    ]);
  });

  it("redirects change-password to the profile page", async () => {
    const response = await (await testApp()).request("/.well-known/change-password");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/profile");
  });
});
