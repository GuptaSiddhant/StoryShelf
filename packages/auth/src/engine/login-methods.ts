/** Login-method wiring: OAuth, social and passkey plugins, the descriptors the login page lists, and the reserved-path guard. */
import { passkey } from "@better-auth/passkey";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { EngineLoginMethod } from "@storyshelf/core/auth";
import type { BetterAuthPlugin } from "better-auth";
import { genericOAuth, type GenericOAuthConfig } from "better-auth/plugins";
import { buildSsoPlugin } from "./sso.ts";
import type { ShelfAuthOptions, ShelfOAuthProvider, ShelfSocialProvider } from "./types.ts";

function toOAuthConfig(provider: ShelfOAuthProvider): GenericOAuthConfig {
  return {
    providerId: provider.id,
    name: provider.label,
    clientId: provider.clientId,
    clientSecret: provider.clientSecret,
    discoveryUrl: provider.discoveryUrl,
    authorizationUrl: provider.authorizationUrl,
    tokenUrl: provider.tokenUrl,
    userInfoUrl: provider.userInfoUrl,
    scopes: provider.scopes ?? ["openid", "email", "profile"],
  };
}

export function buildPlugins(options: ShelfAuthOptions, db: DatabaseAdapter): BetterAuthPlugin[] {
  const oauth = (options.oauth ?? []).map((provider) => toOAuthConfig(provider));
  const base = new URL(options.baseURL);
  return [
    ...(oauth.length > 0 ? [genericOAuth({ config: oauth })] : []),
    ...(options.passkeys
      ? [
          passkey({
            rpID: options.passkeys.rpID ?? base.hostname,
            rpName: options.passkeys.rpName ?? "StoryShelf",
            origin: options.passkeys.origin ?? base.origin,
          }),
        ]
      : []),
    ...(options.sso ? [buildSsoPlugin(options.sso, db)] : []),
    ...(options.plugins ?? []),
  ];
}

function toSocialEntry(provider: ShelfSocialProvider): Record<string, unknown> {
  const entry: Record<string, unknown> = { clientId: provider.clientId };
  if (provider.clientSecret !== undefined) {
    entry["clientSecret"] = provider.clientSecret;
  }
  for (const [key, value] of Object.entries(provider.extra ?? {})) {
    if (value !== undefined) {
      entry[key] = value;
    }
  }
  return entry;
}

export function buildSocialProviders(
  options: ShelfAuthOptions,
): Record<string, Record<string, unknown>> | undefined {
  const providers = options.social ?? [];
  if (providers.length === 0) {
    return undefined;
  }
  const out: Record<string, Record<string, unknown>> = {};
  for (const provider of providers) {
    out[provider.id] = toSocialEntry(provider);
  }
  return out;
}

export function describeLoginMethods(options: ShelfAuthOptions): EngineLoginMethod[] {
  const methods: EngineLoginMethod[] = [
    ...((options.emailPassword ?? true)
      ? [{ kind: "password", id: "password", label: "Email" } as const]
      : []),
    ...(options.passkeys ? [{ kind: "passkey", id: "passkey", label: "Passkey" } as const] : []),
    ...(options.social ?? []).map(
      (provider) => ({ kind: "oauth", id: provider.id, label: provider.label }) as const,
    ),
    ...(options.oauth ?? []).map(
      (provider) => ({ kind: "oauth", id: provider.id, label: provider.label }) as const,
    ),
    ...(options.sso?.providers ?? []).map(
      (provider) => ({ kind: "sso", id: provider.id, label: provider.label }) as const,
    ),
  ];
  const seen = new Set<string>();
  for (const method of methods) {
    if (seen.has(method.id)) {
      throw new Error(
        `Duplicate shelf login method id "${method.id}" (provider ids must be unique across social, oauth, and sso)`,
      );
    }
    seen.add(method.id);
  }
  return methods;
}

/**
 * Engine paths the shelf calls directly: custom plugins (`options.plugins`)
 * must not shadow them (requests would silently hit the wrong handler).
 * Built-in plugins (passkey, SSO, genericOAuth) are shelf-owned and exempt.
 */
const RESERVED_ENGINE_PATHS = [
  "/sign-up/email",
  "/sign-in/email",
  "/sign-in/social",
  "/sign-in/sso",
  "/change-password",
  "/list-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/sign-out",
];

/** Fail fast when a custom plugin shadows a shelf-reserved engine path. */
export function assertNoReservedEndpointCollision(plugins: BetterAuthPlugin[] | undefined): void {
  const reserved = new Set(RESERVED_ENGINE_PATHS);
  for (const plugin of plugins ?? []) {
    for (const endpoint of Object.values(plugin.endpoints ?? {})) {
      if (reserved.has(endpoint.path)) {
        throw new Error(
          `Shelf plugin "${plugin.id}" shadows reserved engine path "${endpoint.path}" (rename the endpoint)`,
        );
      }
    }
  }
}
