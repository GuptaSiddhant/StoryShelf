import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture what the engine hands to the SSO plugin instead of running it.
vi.mock("@better-auth/sso", () => ({
  sso: vi.fn((options: unknown) => ({ id: "sso", options })),
}));

import { sso } from "@better-auth/sso";
import { buildSsoPlugin, SSO_MANAGEMENT_PATHS } from "./sso.ts";
import type { ShelfSSOProvider } from "./types.ts";

const db = {} as DatabaseAdapter;

const OIDC: ShelfSSOProvider = {
  id: "okta",
  label: "Okta",
  domain: "example.com",
  oidc: { issuer: "https://idp.example.com/", clientId: "id", clientSecret: "secret" },
};

const SAML = {
  issuer: "https://sp.example.com",
  entryPoint: "https://idp.example.com/sso",
  cert: "c",
};

interface Captured {
  defaultSSO: Array<Record<string, unknown>>;
  disableImplicitSignUp?: boolean;
  provisionUserOnEveryLogin?: boolean;
  provisionUser?: unknown;
}

/** Build the plugin for these providers and answer the options the SSO plugin received. */
function captured(
  providers: ShelfSSOProvider[],
  extra: { disableImplicitSignUp?: boolean } = {},
): Captured {
  vi.mocked(sso).mockClear();
  buildSsoPlugin({ providers, ...extra }, db);
  expect(sso).toHaveBeenCalledTimes(1);
  return vi.mocked(sso).mock.calls[0]?.[0] as unknown as Captured;
}

beforeEach(() => {
  vi.mocked(sso).mockClear();
});

describe("buildSsoPlugin", () => {
  it("builds the sso plugin", () => {
    expect((buildSsoPlugin({ providers: [OIDC] }, db) as { id: string }).id).toBe("sso");
  });

  it("hands an OIDC provider over with discovery derived from the issuer and the default scopes", () => {
    const [entry] = captured([OIDC]).defaultSSO;
    expect(entry).toEqual({
      domain: "example.com",
      providerId: "okta",
      oidcConfig: {
        issuer: "https://idp.example.com/",
        discoveryEndpoint: "https://idp.example.com/.well-known/openid-configuration",
        pkce: true,
        clientId: "id",
        clientSecret: "secret",
        scopes: ["openid", "email", "profile"],
      },
    });
  });

  it("honours an explicit discovery URL, PKCE off and custom scopes", () => {
    const [entry] = captured([
      {
        ...OIDC,
        oidc: {
          ...OIDC.oidc!,
          discoveryUrl: "https://idp.example.com/d",
          pkce: false,
          scopes: ["openid"],
        },
      },
    ]).defaultSSO;
    expect(entry?.["oidcConfig"]).toMatchObject({
      discoveryEndpoint: "https://idp.example.com/d",
      pkce: false,
      scopes: ["openid"],
    });
  });

  it("hands a SAML provider over with an entity id or with metadata", () => {
    const base = { ...OIDC, oidc: undefined };
    const [byEntity] = captured([
      { ...base, saml: { ...SAML, entityID: "e", audience: "a" } },
    ]).defaultSSO;
    expect(byEntity?.["samlConfig"]).toMatchObject({
      issuer: SAML.issuer,
      entryPoint: SAML.entryPoint,
      cert: "c",
      audience: "a",
      idpMetadata: { entityID: "e" },
    });
    const [byMetadata] = captured([
      { ...base, saml: { ...SAML, metadataXml: "<EntityDescriptor/>", entityID: "e" } },
    ]).defaultSSO;
    expect(byMetadata?.["samlConfig"]).toMatchObject({
      idpMetadata: { metadata: "<EntityDescriptor/>", entityID: "e" },
    });
  });

  it("aliases the groups attribute into the SAML user info", () => {
    const base = { ...OIDC, oidc: undefined, saml: { ...SAML, entityID: "e" } };
    const [entry] = captured([
      { ...base, groups: { claim: ["grp", "other"] } as never },
    ]).defaultSSO;
    expect((entry?.["samlConfig"] as { mapping?: unknown } | undefined)?.mapping).toEqual({
      extraFields: { grp: "grp" },
    });
    const [plain] = captured([base]).defaultSSO;
    expect(plain?.["samlConfig"]).not.toHaveProperty("mapping");
  });

  it("passes the implicit sign-up setting through", () => {
    expect(captured([OIDC], { disableImplicitSignUp: true }).disableImplicitSignUp).toBe(true);
    expect(captured([OIDC]).disableImplicitSignUp).toBeUndefined();
  });

  it("wires the group-sync hook on every login only when a provider syncs groups", () => {
    const plain = captured([OIDC]);
    expect(plain.provisionUser).toBeUndefined();
    expect(plain.provisionUserOnEveryLogin).toBeUndefined();
    const syncing = captured([{ ...OIDC, groups: {} as never }]);
    expect(syncing.provisionUserOnEveryLogin).toBe(true);
    expect(typeof syncing.provisionUser).toBe("function");
  });

  it("refuses a provider with neither oidc nor saml, naming it", () => {
    expect(() => buildSsoPlugin({ providers: [{ ...OIDC, oidc: undefined }] }, db)).toThrow(
      'Shelf SSO provider "okta" needs oidc or saml',
    );
  });

  it("refuses SAML without an entity id or metadata", () => {
    expect(() =>
      buildSsoPlugin({ providers: [{ ...OIDC, oidc: undefined, saml: SAML }] }, db),
    ).toThrow("Shelf SSO SAML needs entityID or metadataXml");
  });

  it("refuses an empty group claim list", () => {
    expect(() =>
      buildSsoPlugin(
        {
          providers: [
            {
              ...OIDC,
              oidc: undefined,
              saml: { ...SAML, entityID: "e" },
              groups: { claim: [] } as never,
            },
          ],
        },
        db,
      ),
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
