/**
 * SSO recipes: code-driven provider entries for the Better Auth SSO plugin.
 *
 * Each preset returns a {@link ShelfSSOProvider} for
 * `createShelfAuth({ sso: { providers } })`. Providers resolve by email
 * domain at sign-in; OIDC entries use IdP discovery, SAML entries use
 * samlify through the plugin (never hand-rolled XML).
 *
 * IdP-side configuration per provider (replace `{baseURL}` and `{id}`):
 * - ACS (reply) URL: `{baseURL}/api/auth/sso/saml2/sp/acs/{id}`
 * - SP metadata: `{baseURL}/api/auth/sso/saml2/sp/metadata?providerId={id}`
 * - OIDC callback: `{baseURL}/api/auth/sso/callback/{id}`
 */
import type { ShelfSSOGroupSync, ShelfSSOProvider } from "../engine.ts";

/** Client credentials shared by the OIDC SSO presets. */
export interface SSOClientOptions {
  /** Email domain routing key (e.g. "acme.example"). */
  domain: string;
  clientId: string;
  clientSecret?: string;
  label?: string;
  /** Stable provider id. Defaults to the preset name. */
  id?: string;
  /** OIDC claim name(s) carrying groups. Defaults to `["groups"]`. */
  groupsClaim?: string | string[];
  /** Exact group names granting the site `admin` role (full reconcile). */
  adminGroups?: string[];
}

/** Group sync shared by the SAML preset. */
export interface SAMLGroupOptions {
  /**
   * SAML attribute name carrying groups (surfaced under the same name).
   * Defaults to `"groups"`.
   */
  groupsAttribute?: string;
  /** Exact group names granting the site `admin` role (full reconcile). */
  adminGroups?: string[];
}

/** Build the `groups` entry when either knob is set (else no group reads). */
function groupSyncOf(options: {
  claim?: string | string[];
  admins?: string[];
}): ShelfSSOGroupSync | undefined {
  if (options.claim === undefined && options.admins === undefined) {
    return undefined;
  }
  return {
    ...(options.claim === undefined ? {} : { claim: options.claim }),
    ...(options.admins === undefined ? {} : { admins: options.admins }),
  };
}

/** IdP metadata for the SAML preset (XML preferred, explicit fields otherwise). */
export interface SAMLIdPOptions {
  /** IdP SSO URL (required by the plugin type; unused when `metadataXml` is set). */
  entryPoint: string;
  /** IdP metadata XML (preferred: carries entity ID, endpoints, and certs). */
  metadataXml?: string;
  /** IdP entity ID (required without `metadataXml`). */
  entityID?: string;
  /** IdP signing cert(s), PEM (ignored when `metadataXml` is set). */
  cert?: string | string[];
}

/** Resolve the IdP authority, failing fast when it is under-specified. */
function samlAuthority(options: SAMLIdPOptions): { metadataXml?: string; entityID?: string } {
  if (options.metadataXml !== undefined) {
    return { metadataXml: options.metadataXml, entityID: options.entityID };
  }
  if (options.entityID === undefined) {
    throw new Error("Shelf SSO SAML needs entityID or metadataXml");
  }
  return { entityID: options.entityID };
}

/** Generic SAML recipe (any IdP with an SSO URL or metadata XML). */
export function samlPreset(
  options: SAMLIdPOptions &
    SAMLGroupOptions & {
      domain: string;
      /** SP entity ID (our audience). */
      issuer: string;
      label?: string;
      id?: string;
    },
): ShelfSSOProvider {
  const authority = samlAuthority(options);
  const syncing = options.adminGroups !== undefined || options.groupsAttribute !== undefined;
  const attribute = options.groupsAttribute ?? "groups";
  return {
    id: options.id ?? "saml",
    label: options.label ?? "SSO",
    domain: options.domain,
    saml: {
      issuer: options.issuer,
      entryPoint: options.entryPoint,
      ...(options.cert === undefined ? {} : { cert: options.cert }),
      ...(authority.metadataXml === undefined ? {} : { metadataXml: authority.metadataXml }),
      ...(authority.entityID === undefined ? {} : { entityID: authority.entityID }),
    },
    ...(syncing
      ? {
          groups: {
            claim: [attribute],
            ...(options.adminGroups === undefined ? {} : { admins: options.adminGroups }),
          },
        }
      : {}),
  };
}

/** Keycloak realm SSO (OIDC discovery over the realm URL). */
export function ssoKeycloakPreset(realmUrl: string, options: SSOClientOptions): ShelfSSOProvider {
  return {
    id: options.id ?? "keycloak",
    label: options.label ?? "Keycloak",
    domain: options.domain,
    oidc: {
      issuer: realmUrl,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
    },
    ...oidcGroupsOf(options),
  };
}

/** OIDC `groups` entry for the client-option presets. */
function oidcGroupsOf(options: SSOClientOptions): Pick<ShelfSSOProvider, "groups"> {
  const groups = groupSyncOf({ claim: options.groupsClaim, admins: options.adminGroups });
  return groups === undefined ? {} : { groups };
}

/** Okta SSO (custom authorization server, OIDC discovery). */
export function ssoOktaPreset(
  options: SSOClientOptions & { authorizationServerId: string },
): ShelfSSOProvider {
  const issuer = `https://${options.domain}/oauth2/${options.authorizationServerId}`;
  return {
    id: options.id ?? "okta",
    label: options.label ?? "Okta",
    domain: options.domain,
    oidc: { issuer, clientId: options.clientId, clientSecret: options.clientSecret },
    ...oidcGroupsOf(options),
  };
}

/** Auth0 SSO (OIDC discovery over the tenant domain). */
export function ssoAuth0Preset(options: SSOClientOptions & { tenant: string }): ShelfSSOProvider {
  return {
    id: options.id ?? "auth0",
    label: options.label ?? "Auth0",
    domain: options.domain,
    oidc: {
      issuer: `https://${options.tenant}/`,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
    },
    ...oidcGroupsOf(options),
  };
}

/** Google Workspace SSO (OIDC discovery; `domain` is the Workspace domain). */
export function ssoGooglePreset(options: SSOClientOptions): ShelfSSOProvider {
  return {
    id: options.id ?? "google-workspace",
    label: options.label ?? "Google",
    domain: options.domain,
    oidc: {
      issuer: "https://accounts.google.com",
      clientId: options.clientId,
      clientSecret: options.clientSecret,
    },
    ...oidcGroupsOf(options),
  };
}

/** Microsoft Entra ID SSO (OIDC discovery over the tenant issuer). */
export function ssoEntraPreset(
  options: SSOClientOptions & { tenantId?: string },
): ShelfSSOProvider {
  const tenant = options.tenantId ?? "common";
  return {
    id: options.id ?? "entra",
    label: options.label ?? "Microsoft",
    domain: options.domain,
    oidc: {
      issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
    },
    ...oidcGroupsOf(options),
  };
}

/** IdP callback URLs for one SSO provider (hand these to the IdP admin). */
export function ssoCallbackUrls(
  baseURL: string,
  providerId: string,
): { acs: string; metadata: string; oidcCallback: string } {
  const root = baseURL.replace(/\/+$/u, "");
  return {
    acs: `${root}/api/auth/sso/saml2/sp/acs/${providerId}`,
    metadata: `${root}/api/auth/sso/saml2/sp/metadata?providerId=${providerId}`,
    oidcCallback: `${root}/api/auth/sso/callback/${providerId}`,
  };
}
