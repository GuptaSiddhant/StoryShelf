/**
 * Live OAuth/OIDC test — strictly real provider, no stubbed fetch.
 *
 * Gated on `LIVE_CLOUD=1` plus `OIDC_ISSUER`, so hermetic `turbo test`
 * never touches the network. `setup()` warms OIDC discovery against the
 * real issuer (`{issuer}/.well-known/openid-configuration`); no browser or
 * user interaction is involved — the full code-exchange flow is intentionally
 * out of scope (it needs an interactive login). `loginUrl()` output is
 * asserted structurally.
 *
 * Required env when live:
 * - `OIDC_ISSUER` — e.g. `https://keycloak.example.com/realms/myteam`
 * - `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` — registered OIDC client
 * - `OIDC_REDIRECT_URL` — registered redirect (defaults to
 *   `http://localhost:3000/auth/callback`; only used to build the login URL,
 *   never called).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createOAuthAuth } from "./index.ts";

const LIVE = process.env["LIVE_CLOUD"] === "1" && process.env["OIDC_ISSUER"] !== undefined;

function liveIssuer(): string {
  const issuer = process.env["OIDC_ISSUER"];
  if (!issuer) {
    throw new Error("Live OAuth test requires OIDC_ISSUER.");
  }
  return issuer;
}

function liveClientId(): string {
  return process.env["OIDC_CLIENT_ID"] ?? "storyshelf-live-test";
}

function liveClientSecret(): string {
  return process.env["OIDC_CLIENT_SECRET"] ?? "live-test-placeholder";
}

function liveRedirectUrl(): string {
  return process.env["OIDC_REDIRECT_URL"] ?? "http://localhost:3000/auth/callback";
}

describe.skipIf(!LIVE)("oauth live (real OIDC discovery, gated on LIVE_CLOUD=1)", () => {
  beforeAll(async () => {
    const auth = createOAuthAuth({
      issuer: liveIssuer(),
      clientId: liveClientId(),
      clientSecret: liveClientSecret(),
      secret: randomUUID(),
      redirectUrl: liveRedirectUrl(),
    });
    // Warms discovery over real HTTPS — throws when the issuer is unreachable
    // or the discovery document is invalid.
    await auth.lifecycle?.setup({} as never);
    await auth.lifecycle?.teardown();
  });

  it("warms discovery and builds a login URL for the real issuer", async () => {
    const issuer = liveIssuer();
    const auth = createOAuthAuth({
      issuer,
      clientId: liveClientId(),
      clientSecret: liveClientSecret(),
      secret: randomUUID(),
      redirectUrl: liveRedirectUrl(),
    });
    await auth.lifecycle?.setup({} as never);
    try {
      const url = new URL(auth.loginUrl("live-state"));
      expect(url.searchParams.get("client_id")).toBe(liveClientId());
      expect(url.searchParams.get("state")).toBe("live-state");
      expect(url.searchParams.get("redirect_uri")).toBe(liveRedirectUrl());
    } finally {
      await auth.lifecycle?.teardown();
    }
  });
});
