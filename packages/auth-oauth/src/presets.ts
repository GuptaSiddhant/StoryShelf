import type { OAuthAuthOptions, PresetBaseOptions } from "./types.ts";

/** Keycloak realm preset (explicit endpoints; no discovery needed). */
export function keycloakPreset(realmUrl: string, options: PresetBaseOptions): OAuthAuthOptions {
  return { ...options, issuer: realmUrl };
}

/** Okta preset (custom authorization server). */
export function oktaPreset(
  domain: string,
  authorizationServerId: string,
  options: PresetBaseOptions,
): OAuthAuthOptions {
  const issuer = `https://${domain}/oauth2/${authorizationServerId}`;
  return {
    ...options,
    issuer,
    authorizationEndpoint: `${issuer}/v1/authorize`,
    tokenEndpoint: `${issuer}/v1/token`,
    userinfoEndpoint: `${issuer}/v1/userinfo`,
  };
}

/** Microsoft Entra ID preset (tenant issuer; groups arrive as object IDs). */
export function entraPreset(tenantId: string, options: PresetBaseOptions): OAuthAuthOptions {
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  return {
    ...options,
    issuer,
    authorizationEndpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
    tokenEndpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    userinfoEndpoint: "https://graph.microsoft.com/oidc/userinfo",
  };
}

/** Amazon Cognito User Pool preset (groups arrive as `cognito:groups`). */
export function cognitoPreset(
  region: string,
  userPoolId: string,
  options: PresetBaseOptions,
): OAuthAuthOptions {
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  return {
    ...options,
    issuer,
    authorizationEndpoint: `${issuer}/oauth2/authorize`,
    tokenEndpoint: `${issuer}/oauth2/token`,
    userinfoEndpoint: `${issuer}/oauth2/userInfo`,
  };
}

/**
 * Auth0 preset (groups require a tenant Action writing a namespaced custom
 * claim — Auth0 emits no group claim by default).
 */
export function auth0Preset(domain: string, options: PresetBaseOptions): OAuthAuthOptions {
  const issuer = `https://${domain}/`;
  return {
    ...options,
    issuer,
    authorizationEndpoint: `${issuer}authorize`,
    tokenEndpoint: `${issuer}oauth/token`,
    userinfoEndpoint: `${issuer}userinfo`,
  };
}
