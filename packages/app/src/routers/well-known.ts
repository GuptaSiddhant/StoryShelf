import { isMultiAuth, type AuthAdapter, type MultiAuthMethod } from "@storyshelf/core/adapter/auth";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";

/** Whether an adapter supports the OAuth authorization-code callback. */
function hasCallback(adapter: AuthAdapter): boolean {
  // oxlint-disable-next-line typescript/unbound-method -- interface method, no this
  return adapter.handleCallback !== undefined;
}

/** OIDC-capable login methods (SSO providers) on an adapter. */
function ssoProviders(auth: AuthAdapter): MultiAuthMethod[] {
  if (isMultiAuth(auth)) {
    return auth.methods().filter((method) => hasCallback(method.adapter));
  }
  return hasCallback(auth) ? [{ id: "sso", label: "SSO", adapter: auth }] : [];
}

function callbackRoutes(auth: AuthAdapter): string[] {
  if (isMultiAuth(auth)) {
    return ssoProviders(auth).map((method) => `/auth/callback/${method.id}`);
  }
  return auth.handleCallback ? ["/auth/callback"] : [];
}

function requestOrigin(c: Context): string {
  return getStore().config.publicBaseUrl ?? new URL(c.req.url).origin;
}

/** Register public relying-party helper documents (no auth required). */
export function registerWellKnown(app: ShelfRouter, auth: AuthAdapter): void {
  app.get("/.well-known/openid-configuration", (c) => {
    const origin = requestOrigin(c);
    const providers = ssoProviders(auth);
    return c.json(
      {
        issuer: origin,
        note: "StoryShelf is an OpenID Connect relying party, not an identity provider. This document helps operators register redirect URIs with their provider; it is not provider metadata.",
        response_types_supported: ["code"],
        scopes_supported: ["openid", "email", "profile"],
        redirect_uris: callbackRoutes(auth).map((route) => `${origin}${route}`),
        providers: providers.map((method) => ({ id: method.id, label: method.label })),
      },
      200,
      { "Cache-Control": "public, max-age=300" },
    );
  });

  // oxlint-disable-next-line typescript/promise-function-async -- Hono handler may return Response directly
  app.get("/.well-known/change-password", (c) => c.redirect("/profile", 302));
}
