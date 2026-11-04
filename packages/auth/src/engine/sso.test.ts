import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { describe, expect, it } from "vitest";
import { buildSsoPlugin, SSO_MANAGEMENT_PATHS } from "./sso.ts";
import type { ShelfSSOProvider } from "./types.ts";

const db = {} as DatabaseAdapter;

const OIDC: ShelfSSOProvider = {
  id: "okta",
  label: "Okta",
  domain: "example.com",
  oidc: { issuer: "https://idp.example.com/", clientId: "id", clientSecret: "secret" },
};

function plugin(...providers: ShelfSSOProvider[]): unknown {
  return buildSsoPlugin({ providers }, db);
}

describe("buildSsoPlugin", () => {
  it("builds the sso plugin for an OIDC provider", () => {
    expect((plugin(OIDC) as { id: string }).id).toBe("sso");
  });

  it("builds it for a SAML provider with an entity id or with metadata", () => {
    const saml = {
      issuer: "https://sp.example.com",
      entryPoint: "https://idp.example.com/sso",
      cert: "c",
    };
    expect(() =>
      plugin({ ...OIDC, oidc: undefined, saml: { ...saml, entityID: "e" } }),
    ).not.toThrow();
    expect(() =>
      plugin({ ...OIDC, oidc: undefined, saml: { ...saml, metadataXml: "<EntityDescriptor/>" } }),
    ).not.toThrow();
  });

  it("refuses a provider with neither oidc nor saml, naming it", () => {
    expect(() => plugin({ ...OIDC, oidc: undefined })).toThrow(
      'Shelf SSO provider "okta" needs oidc or saml',
    );
  });

  it("refuses SAML without an entity id or metadata", () => {
    expect(() =>
      plugin({
        ...OIDC,
        oidc: undefined,
        saml: { issuer: "i", entryPoint: "https://idp.example.com/sso", cert: "c" },
      }),
    ).toThrow("Shelf SSO SAML needs entityID or metadataXml");
  });

  it("refuses an empty group claim list", () => {
    expect(() =>
      plugin({
        ...OIDC,
        oidc: undefined,
        saml: { issuer: "i", entryPoint: "e", cert: "c", entityID: "e" },
        groups: { claim: [] },
      }),
    ).toThrow("Shelf SSO groups.claim must name at least one claim");
  });
});

describe("SSO_MANAGEMENT_PATHS", () => {
  it("blocks every runtime provider-management and domain-verification path", () => {
    expect(SSO_MANAGEMENT_PATHS.toSorted()).toEqual([
      "/sso/delete-provider",
      "/sso/get-provider",
      "/sso/providers",
      "/sso/register",
      "/sso/request-domain-verification",
      "/sso/update-provider",
      "/sso/verify-domain",
    ]);
  });
});
