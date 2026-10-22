import type { Auth } from "@storyshelf/core/auth";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";

/** One SSO-capable login method with its IdP reply URLs. */
interface SsoProviderLink {
  id: string;
  label: string;
  redirectUris: string[];
}

/** SSO-capable login methods (oauth buttons + SSO) with IdP reply URLs. */
function ssoProviders(auth: Auth, origin: string): SsoProviderLink[] {
  return auth
    .loginMethods()
    .filter((method) => method.kind === "oauth" || method.kind === "sso")
    .map((method) => ({
      id: method.id,
      label: method.label,
      redirectUris:
        method.kind === "sso"
          ? [
              `${origin}/api/auth/sso/callback/${method.id}`,
              `${origin}/api/auth/sso/saml2/sp/acs/${method.id}`,
            ]
          : [`${origin}/api/auth/callback/${method.id}`],
    }));
}

/**
 * The origin of this interactive, request-bound document (ADR 0007, decision 6): the confirmed
 * public origin, else the address the request came in on (the one place besides OAuth redirect
 * URIs where authentication may use it).
 */
async function requestOrigin(c: Context): Promise<string> {
  const { publicOrigin, config } = getStore();
  const own = new URL(c.req.url).origin;
  return publicOrigin ? await publicOrigin.authOrigin(own) : (config.publicBaseUrl ?? own);
}

/** Register public relying-party helper documents (no auth required). */
export function registerWellKnown(app: ShelfRouter, auth: Auth): void {
  app.get("/.well-known/openid-configuration", async (c) => {
    const origin = await requestOrigin(c);
    const providers = ssoProviders(auth, origin);
    return c.json(
      {
        issuer: origin,
        note: "StoryShelf is an OpenID Connect relying party, not an identity provider. This document helps operators register redirect URIs with their provider; it is not provider metadata.",
        response_types_supported: ["code"],
        scopes_supported: ["openid", "email", "profile"],
        redirect_uris: providers.flatMap((provider) => provider.redirectUris),
        providers: providers.map((method) => ({ id: method.id, label: method.label })),
      },
      200,
      { "Cache-Control": "public, max-age=300" },
    );
  });

  // oxlint-disable-next-line typescript/promise-function-async -- Hono handler may return Response directly
  app.get("/.well-known/change-password", (c) => c.redirect("/profile", 302));
}
