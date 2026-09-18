/**
 * OAuth/OIDC auth adapter: authorization-code flow against any
 * OpenID Connect provider (Keycloak, Okta, Entra ID, Cognito, Auth0).
 *
 * Provider presets live under `@storyshelf/auth-oauth/presets`.
 */
import type { AuthCallback, AuthUser } from "@storyshelf/core/adapter/auth";
import { createEndpointDiscovery } from "./endpoints.ts";
import { buildLoginUrl, exchangeCode, fetchUserInfo } from "./flow.ts";
import { createSessionHandlers } from "./session.ts";
import type { OAuthAuth, OAuthAuthOptions } from "./types.ts";

declare const __PKG_VERSION__: string | undefined;

/**
 * Create an OAuth/OIDC auth adapter.
 *
 * @param options - OIDC provider and session configuration.
 * @returns An OAuthAuth instance.
 */
export function createOAuthAuth(options: OAuthAuthOptions): OAuthAuth {
  const { secret } = options;
  const scopes = options.scopes ?? ["openid", "email", "profile"];
  const discovery = createEndpointDiscovery(options);
  const sessions = createSessionHandlers(secret);

  const handleCallback = async (callback: AuthCallback): Promise<AuthUser | null> => {
    const resolved = await discovery.resolve();
    const token = await exchangeCode(resolved, options, callback.code);
    if (!token) {
      return null;
    }
    return fetchUserInfo(resolved, options, token);
  };

  return {
    metadata: {
      name: "OAuth",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "OAuth/OIDC auth adapter",
      kind: "oauth",
      category: "auth",
    },
    lifecycle: buildLifecycle(options, async () => {
      await discovery.warm();
    }),
    check: sessions.check,
    createSession: sessions.createSession,
    async destroySession() {
      await Promise.resolve();
    },
    handleCallback,
    loginUrl: (state: string) => buildLoginUrl(discovery.current(), options, scopes, state),
  };
}

/** Lifecycle: fail fast when OIDC wiring is missing. */
function buildLifecycle(
  options: OAuthAuthOptions,
  warmEndpoints: () => Promise<void>,
): OAuthAuth["lifecycle"] {
  return {
    setup: async () => {
      if (options.issuer === "" || options.clientId === "" || options.clientSecret === "") {
        throw new Error("OAuth auth requires a non-empty issuer, clientId, and clientSecret");
      }
      await warmEndpoints();
    },
    teardown: async () => {
      // Stateless — nothing to destroy.
      await Promise.resolve();
    },
    health: async () => {
      await Promise.resolve();
      return { ok: true };
    },
  };
}

export type { OAuthAuth, OAuthAuthOptions, OidcEndpoints, PresetBaseOptions } from "./types.ts";
export { auth0Preset, cognitoPreset, entraPreset, keycloakPreset, oktaPreset } from "./presets.ts";
