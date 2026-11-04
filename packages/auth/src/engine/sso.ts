/** SSO setup: the plugin over static OIDC and SAML providers (with group sync) and the management paths kept off. */
import { sso, type SSOOptions } from "@better-auth/sso";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { BetterAuthPlugin } from "better-auth";
import { DEFAULT_GROUP_CLAIM, provisionHook } from "../groups.ts";
import type {
  ShelfSSOGroupSync,
  ShelfSSOOidc,
  ShelfSSOOptions,
  ShelfSSOProvider,
  ShelfSSOSaml,
} from "./types.ts";

/** SSO plugin with static providers plus the shelf group-sync hook. */
export function buildSsoPlugin(options: ShelfSSOOptions, db: DatabaseAdapter): BetterAuthPlugin {
  const providers = options.providers;
  const syncing = providers.some((provider) => provider.groups !== undefined);
  return sso({
    defaultSSO: toSSODefaultEntries(options),
    disableImplicitSignUp: options.disableImplicitSignUp,
    // Group sync runs inside the plugin's own transaction on every sign-in
    // (first login and beyond); plain db ops join the ambient transaction.
    ...(syncing
      ? { provisionUserOnEveryLogin: true, provisionUser: provisionHook(db, providers) }
      : {}),
  });
}

/** Static SSO entries for the plugin (code-driven; take precedence over DB rows). */
type SSODefaultEntry = NonNullable<SSOOptions["defaultSSO"]>[number];

function toSSOOidcEntry(oidc: ShelfSSOOidc): NonNullable<SSODefaultEntry["oidcConfig"]> {
  return {
    issuer: oidc.issuer,
    discoveryEndpoint:
      oidc.discoveryUrl ?? `${oidc.issuer.replace(/\/+$/u, "")}/.well-known/openid-configuration`,
    pkce: oidc.pkce ?? true,
    clientId: oidc.clientId,
    clientSecret: oidc.clientSecret,
    // Explicit default (the plugin would add offline_access): matches the
    // ShelfSSOOidc contract and the E6 genericOAuth recipes.
    scopes: oidc.scopes ?? ["openid", "email", "profile"],
  };
}

function toSSOSamlShared(saml: ShelfSSOSaml): {
  issuer: string;
  entryPoint: string;
  cert: string | string[] | undefined;
  audience: string | undefined;
  wantAssertionsSigned: boolean | undefined;
} {
  return {
    issuer: saml.issuer,
    entryPoint: saml.entryPoint,
    cert: saml.cert,
    audience: saml.audience,
    wantAssertionsSigned: saml.wantAssertionsSigned,
  };
}

function toSSOSamlEntry(
  provider: ShelfSSOProvider,
  saml: ShelfSSOSaml,
): NonNullable<SSODefaultEntry["samlConfig"]> {
  const shared = toSSOSamlShared(saml);
  // Surface the groups attribute into userInfo (the plugin only forwards
  // mapped fields): alias equals attribute name, read back by extractGroups.
  const mapping =
    provider.groups === undefined
      ? undefined
      : { extraFields: { [groupClaimAlias(provider.groups)]: groupClaimAlias(provider.groups) } };
  if (saml.metadataXml !== undefined) {
    return {
      ...shared,
      ...(mapping === undefined ? {} : { mapping }),
      idpMetadata: { metadata: saml.metadataXml, entityID: saml.entityID },
    };
  }
  if (saml.entityID === undefined) {
    throw new Error("Shelf SSO SAML needs entityID or metadataXml");
  }
  return {
    ...shared,
    ...(mapping === undefined ? {} : { mapping }),
    idpMetadata: { entityID: saml.entityID },
  };
}

/** First claim name: the userInfo alias for the groups attribute. */
function groupClaimAlias(groups: ShelfSSOGroupSync): string {
  const claim = groups.claim;
  if (claim === undefined) {
    return DEFAULT_GROUP_CLAIM;
  }
  const first = Array.isArray(claim) ? claim[0] : claim;
  if (!first) {
    throw new Error("Shelf SSO groups.claim must name at least one claim");
  }
  return first;
}

function toSSODefaultEntry(provider: ShelfSSOProvider): SSODefaultEntry {
  if (!provider.oidc && !provider.saml) {
    throw new Error(`Shelf SSO provider "${provider.id}" needs oidc or saml`);
  }
  return {
    domain: provider.domain,
    providerId: provider.id,
    ...(provider.oidc ? { oidcConfig: toSSOOidcEntry(provider.oidc) } : {}),
    ...(provider.saml ? { samlConfig: toSSOSamlEntry(provider, provider.saml) } : {}),
  };
}

function toSSODefaultEntries(options: ShelfSSOOptions): SSODefaultEntry[] {
  return options.providers.map((provider) => toSSODefaultEntry(provider));
}

/**
 * SSO provider-management paths blocked at the engine mount: shelf SSO
 * providers are code-driven recipes (`defaultSSO`), so runtime registration,
 * mutation, and domain verification stay off (any signed-in member could
 * otherwise register a rogue IdP for an arbitrary domain).
 */
export const SSO_MANAGEMENT_PATHS = [
  "/sso/register",
  "/sso/providers",
  "/sso/get-provider",
  "/sso/update-provider",
  "/sso/delete-provider",
  "/sso/request-domain-verification",
  "/sso/verify-domain",
];
