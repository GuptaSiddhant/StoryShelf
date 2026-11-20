import { afterEach, describe, expect, it, vi } from "vitest";
import { providerChecksOf } from "./provider-checks.ts";
import type { ShelfAuthOptions } from "./types.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

function options(extra: Partial<ShelfAuthOptions>): ShelfAuthOptions {
  return extra as ShelfAuthOptions;
}

const sso = {
  id: "acme",
  label: "Acme SSO",
  domain: "acme.example",
  oidc: { issuer: "https://idp.acme.example/realm/", clientId: "c", clientSecret: "s3cret" },
};

describe("providerChecksOf", () => {
  it("has a check per discovery-based OIDC provider and none for the rest", () => {
    const checks = providerChecksOf(
      options({
        oauth: [
          {
            id: "kc",
            label: "Keycloak",
            clientId: "c",
            discoveryUrl: "https://kc.example/.well-known/openid-configuration",
          },
          { id: "manual", label: "Manual", clientId: "c", tokenUrl: "https://m.example/token" },
        ],
        sso: {
          providers: [
            sso,
            {
              id: "saml",
              label: "SAML",
              domain: "s.example",
              saml: { issuer: "i", entryPoint: "e" },
            },
          ],
        },
      }),
    );
    expect(checks.map((check) => check.id)).toEqual(["kc", "acme"]);
    expect(providerChecksOf(options({}))).toEqual([]);
  });

  it("is ok when the discovery document names an issuer, and says only the origin", async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      Response.json({ issuer: "https://idp.acme.example" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const [check] = providerChecksOf(options({ sso: { providers: [sso] } }));
    const result = await check?.check();
    expect(result).toEqual({ ok: true, detail: "discovery reachable at https://idp.acme.example" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://idp.acme.example/realm/.well-known/openid-configuration",
    );
    expect(JSON.stringify(result)).not.toContain("s3cret");
  });

  it("fails a document without an issuer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({})),
    );
    const [check] = providerChecksOf(options({ sso: { providers: [sso] } }));
    expect(await check?.check()).toMatchObject({ ok: false });
  });

  it("rejects when the provider is unreachable (the report turns that into a failed row)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 404 })),
    );
    const [check] = providerChecksOf(options({ sso: { providers: [sso] } }));
    await expect(check?.check()).rejects.toThrow();
  });
});
