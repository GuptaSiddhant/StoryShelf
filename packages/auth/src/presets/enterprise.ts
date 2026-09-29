/**
 * Enterprise OIDC recipes: generic-OAuth configs for providers without a
 * Better Auth native integration.
 *
 * Each preset returns a {@link ShelfOAuthProvider} for
 * `createShelfAuth({ oauth })`. Endpoint construction mirrors the retired
 * `auth-oauth` presets so existing issuer URLs keep working; Keycloak
 * prefers discovery, Okta/Auth0 pin explicit endpoints.
 */
import type { ShelfOAuthProvider } from "../engine.ts";

/** Client credentials shared by the enterprise presets. */
export interface EnterpriseClientOptions {
  clientId: string;
  clientSecret?: string;
  label?: string;
}

/** Keycloak realm preset (discovery over the realm URL). */
export function keycloakPreset(
  realmUrl: string,
  options: EnterpriseClientOptions,
): ShelfOAuthProvider {
  return {
    id: "keycloak",
    label: options.label ?? "Keycloak",
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    discoveryUrl: `${realmUrl.replace(/\/+$/u, "")}/.well-known/openid-configuration`,
  };
}

/** Okta preset (custom authorization server, explicit endpoints). */
export function oktaPreset(
  options: EnterpriseClientOptions & { domain: string; authorizationServerId: string },
): ShelfOAuthProvider {
  const issuer = `https://${options.domain}/oauth2/${options.authorizationServerId}`;
  return {
    id: "okta",
    label: options.label ?? "Okta",
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    authorizationUrl: `${issuer}/v1/authorize`,
    tokenUrl: `${issuer}/v1/token`,
    userInfoUrl: `${issuer}/v1/userinfo`,
  };
}

/** Auth0 preset (explicit endpoints; groups need a tenant Action claim). */
export function auth0Preset(
  options: EnterpriseClientOptions & { domain: string },
): ShelfOAuthProvider {
  const issuer = `https://${options.domain}/`;
  return {
    id: "auth0",
    label: options.label ?? "Auth0",
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    authorizationUrl: `${issuer}authorize`,
    tokenUrl: `${issuer}oauth/token`,
    userInfoUrl: `${issuer}userinfo`,
  };
}
