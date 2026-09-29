import { passkey } from "@better-auth/passkey";
import { sso, type SSOOptions } from "@better-auth/sso";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { Auth, EngineLoginMethod } from "@storyshelf/core/auth";
import { UserModel } from "@storyshelf/core/models";
/**
 * Shelf auth engine: Better Auth protocol plumbing behind the Auth singleton.
 *
 * Sessions are wholesale Better Auth DB rows under our cookie name;
 * identities mirror into our `users` table (source of truth for roles,
 * memberships, and profile). All logins flow through engine endpoints
 * (mounted at `/api/auth/*`) — never through `createSession`, which exists
 * only for interface conformance and fails loudly.
 */
import { SESSION_COOKIE, type AuthUser } from "@storyshelf/core/types";
import { ulid } from "@storyshelf/core/utils";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { genericOAuth, type GenericOAuthConfig } from "better-auth/plugins";
import { baseAuthDateFields, baseAuthTables } from "./auth-tables.ts";
import { createShelfDbBridge } from "./db-bridge.ts";
import { DEFAULT_GROUP_CLAIM, provisionHook } from "./groups.ts";
import { acceptInvite, issueInvite, verifyInvite } from "./invites.ts";
import { hasPasswordCredential, listUserPasskeys } from "./passkeys.ts";
import { deleteSessionByToken, deleteUserSessions, listUserSessions } from "./sessions.ts";

declare const __PKG_VERSION__: string | undefined;

/** Provider id minted on every engine identity (method attribution is future work). */
export const ENGINE_PROVIDER_ID = "better-auth";

/** Options for {@link createShelfAuth}. */
export interface ShelfAuthOptions {
  /** Shelf database (any driver; auth tables migrate via driver DDL). */
  db: DatabaseAdapter;
  /** Session/cookie signing secret (non-empty; Better Auth validates strength). */
  secret: string;
  /** Public base URL issuing auth responses (callback + cookie scope). */
  baseURL: string;
  /** Enable email/password login. Defaults to true. */
  emailPassword?: boolean;
  /** Native social providers (GitHub, Google, Entra, Cognito...), each one button. */
  social?: ShelfSocialProvider[];
  /** OAuth/OIDC providers, each rendered as one login button. Defaults to none. */
  oauth?: ShelfOAuthProvider[];
  /** WebAuthn passkeys (profile enrollment; sign-in ceremony is E8). Defaults to off. */
  passkeys?: ShelfPasskeyOptions;
  /** Domain-routed SSO (OIDC discovery + SAML via samlify). Defaults to none. */
  sso?: ShelfSSOOptions;
  /** Extra Better Auth plugins (passkey, SSO, ...). Defaults to none. */
  plugins?: BetterAuthPlugin[];
  /** Session lifetime in days. Defaults to 7 (current parity). */
  sessionExpiresInDays?: number;
}

/** One OAuth/OIDC login method (Keycloak preset or explicit endpoints). */
export interface ShelfOAuthProvider {
  /** Stable id used in routes and descriptors (e.g. "keycloak"). */
  id: string;
  /** Human label rendered on the login button. */
  label: string;
  /** OAuth client ID registered with the provider. */
  clientId: string;
  /** OAuth client secret (omit for public clients). */
  clientSecret?: string;
  /** OIDC discovery URL; prefer over explicit endpoints when available. */
  discoveryUrl?: string;
  /** Explicit endpoint overrides (skip discovery for these). */
  authorizationUrl?: string;
  /** Explicit endpoint overrides (skip discovery for these). */
  tokenUrl?: string;
  /** Explicit endpoint overrides (skip discovery for these). */
  userInfoUrl?: string;
  /** OAuth scopes. Defaults to `["openid", "email", "profile"]`. */
  scopes?: string[];
}

/** One native social login method (Better Auth built-in provider). */
export interface ShelfSocialProvider {
  /** Better Auth provider key (e.g. "github", "microsoft", "cognito"). */
  id: "github" | "gitlab" | "google" | "microsoft" | "cognito";
  /** Human label rendered on the login button. */
  label: string;
  /** OAuth client ID registered with the provider. */
  clientId: string;
  /** OAuth client secret (omit for public clients). */
  clientSecret?: string;
  /** Provider-specific options (tenantId, domain, region, userPoolId, issuer...). */
  extra?: Record<string, string | undefined>;
}

/** WebAuthn passkey config (profile enrollment; sign-in ceremony is E8). */
export interface ShelfPasskeyOptions {
  /**
   * Relying-party id. Defaults to the baseURL hostname.
   *
   * WebAuthn needs a secure context: `localhost` (any port) or HTTPS.
   * Plain-HTTP LAN/IP deployments cannot use passkeys — the UI hides
   * passkey affordances there (see `passkey-ceremony.ts`).
   */
  rpID?: string;
  /** Human-readable site title. Defaults to "StoryShelf". */
  rpName?: string;
  /** Allowed origins (no trailing slash). Defaults to the baseURL origin. */
  origin?: string | string[];
}

/** OIDC SSO connection (discovery-based, resolved by email domain). */
export interface ShelfSSOOidc {
  /** IdP issuer (e.g. the Keycloak realm URL). */
  issuer: string;
  /** Discovery document URL. Defaults to `issuer + /.well-known/openid-configuration`. */
  discoveryUrl?: string;
  /** OAuth client ID registered with the provider. */
  clientId: string;
  /** OAuth client secret (omit for public clients). */
  clientSecret?: string;
  /** OAuth scopes. Defaults to `["openid", "email", "profile"]`. */
  scopes?: string[];
  /** Use PKCE. Defaults to true. */
  pkce?: boolean;
}

/** SAML SSO connection (samlify via the SSO plugin; never hand-rolled XML). */
export interface ShelfSSOSaml {
  /** SP entity ID (our audience; also the metadata default). */
  issuer: string;
  /** IdP SSO URL (required by the plugin type; unused when `metadataXml` is set). */
  entryPoint: string;
  /** IdP signing cert(s), PEM (ignored when `metadataXml` is set). */
  cert?: string | string[];
  /** IdP metadata XML (preferred: carries entity ID, endpoints, and certs). */
  metadataXml?: string;
  /** IdP entity ID (required without `metadataXml`). */
  entityID?: string;
  /** Expected audience (defaults to the SP issuer). */
  audience?: string;
  /** Reject unsigned assertions. Defaults to false. */
  wantAssertionsSigned?: boolean;
}

/** IdP group sync for one SSO provider (site role + project memberships). */
export interface ShelfSSOGroupSync {
  /**
   * Claim (OIDC) or attribute (SAML) name(s) carrying group memberships.
   * First hit wins across names; arrays pass through, a lone string counts
   * as one group (never whitespace-split). Defaults to `["groups"]`.
   */
  claim?: string | string[];
  /**
   * Exact group names granting the site `admin` role. Full reconcile:
   * members not matched reset to `member` on every SSO sign-in.
   * Defaults to none (roles untouched).
   */
  admins?: string[];
}

/** One domain-routed SSO login method (OIDC, SAML, or both). */
export interface ShelfSSOProvider {
  /** Stable id used in routes and descriptors (e.g. "acme-sso"). */
  id: string;
  /** Human label rendered on the login button. */
  label: string;
  /** Email domain routing key (e.g. "acme.example"). */
  domain: string;
  /** OIDC connection. Defaults to none. */
  oidc?: ShelfSSOOidc;
  /** SAML connection. Defaults to none. */
  saml?: ShelfSSOSaml;
  /** IdP group sync. Defaults to none (no group reads, roles untouched). */
  groups?: ShelfSSOGroupSync;
}

/** Domain-routed SSO (OIDC discovery + SAML). Defaults to none. */
export interface ShelfSSOOptions {
  /** SSO providers, each rendered as one login button. */
  providers: ShelfSSOProvider[];
  /** Require explicit sign-up confirmation for new SSO users. Defaults to false. */
  disableImplicitSignUp?: boolean;
}

/** Session user fields the shelf reads back. */
export interface EngineSessionUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
}

/** Subset of the Better Auth instance surface the shelf uses. */
export interface ShelfAuthInstance {
  /** HTTP handler (mount at `/api/auth/*`). */
  handler: (request: Request) => Response | Promise<Response>;
  api: {
    /** Resolve the session user from request headers (null when anonymous). */
    getSession(input: { headers: Headers }): Promise<{ user: EngineSessionUser } | null>;
    /** Revoke the session carried by the headers. */
    signOut(input: { headers: Headers }): Promise<unknown>;
  };
}

/** Engine handle: raw instance for mounting plus the Auth singleton. */
export interface ShelfAuth {
  /** Better Auth instance (mount `auth.handler`, call `auth.api.*`). */
  auth: ShelfAuthInstance;
  /** Auth singleton (check/destroySession, invites, sessions, descriptors). */
  adapter: Auth;
}

function toAuthUser(
  sessionUser: { id: string; email: string; name: string; image?: string | null },
  role: AuthUser["role"],
  displayName: string | null,
): AuthUser {
  return {
    id: sessionUser.id,
    email: sessionUser.email,
    // Empty overrides fall back (writes normalize "" to null, but legacy
    // rows may still hold one).
    name: displayName === "" || displayName === null ? sessionUser.name : displayName,
    avatarUrl: sessionUser.image ?? undefined,
    role,
    providerId: ENGINE_PROVIDER_ID,
  };
}

async function mirrorUser(db: DatabaseAdapter, created: unknown): Promise<void> {
  const user = created as { id: string; email: string; name: string; image?: string | null };
  // Never demote: an engine row created for a staged invitee (admin role)
  // would otherwise overwrite the role with the default.
  const existing = await new UserModel(db).get(user.id);
  await new UserModel(db).upsert({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.image ?? null,
    role: existing?.role ?? "member",
  });
}

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

function buildPlugins(options: ShelfAuthOptions, db: DatabaseAdapter): BetterAuthPlugin[] {
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

/** SSO plugin with static providers plus the shelf group-sync hook. */
function buildSsoPlugin(options: ShelfSSOOptions, db: DatabaseAdapter): BetterAuthPlugin {
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

function buildSocialProviders(
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

function describeLoginMethods(options: ShelfAuthOptions): EngineLoginMethod[] {
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
function assertNoReservedEndpointCollision(plugins: BetterAuthPlugin[] | undefined): void {
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

/**
 * SSO provider-management paths blocked at the engine mount: shelf SSO
 * providers are code-driven recipes (`defaultSSO`), so runtime registration,
 * mutation, and domain verification stay off (any signed-in member could
 * otherwise register a rogue IdP for an arbitrary domain).
 */
const SSO_MANAGEMENT_PATHS = [
  "/sso/register",
  "/sso/providers",
  "/sso/get-provider",
  "/sso/update-provider",
  "/sso/delete-provider",
  "/sso/request-domain-verification",
  "/sso/verify-domain",
];

/**
 * Build the Better Auth instance with shelf-curated defaults: email/password,
 * DB sessions under our cookie name, no cookie cache (revocation and
 * disabled-users bite immediately), ULID ids shared with our `users` table,
 * mirror hook on user creation.
 */
function buildAuthInstance(options: ShelfAuthOptions, db: DatabaseAdapter): ShelfAuthInstance {
  const expiresIn = 60 * 60 * 24 * (options.sessionExpiresInDays ?? 7);
  const socialProviders = buildSocialProviders(options);
  const auth = betterAuth({
    baseURL: options.baseURL,
    secret: options.secret,
    database: createShelfDbBridge(db, {
      tables: baseAuthTables,
      dateFields: baseAuthDateFields,
    }),
    emailAndPassword: {
      enabled: options.emailPassword ?? true,
      requireEmailVerification: false,
      // Invite-only local accounts: public email signup stays off so the
      // only credential origins are invite accept, env bootstrap, and SSO
      // provisioning (all write identities directly, never via sign-up).
      disableSignUp: true,
    },
    // Native socials are option bags per provider key; our preset-built
    // records match those shapes, so narrow past the generated union.
    ...(socialProviders ? { socialProviders: socialProviders as never } : {}),
    // Shelf SSO providers are code-driven recipes; runtime provider
    // management stays off (see SSO_MANAGEMENT_PATHS).
    ...(options.sso ? { disabledPaths: SSO_MANAGEMENT_PATHS } : {}),
    session: { expiresIn, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    advanced: {
      database: { generateId: () => ulid() },
      cookies: { session_token: { name: SESSION_COOKIE } },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (created: unknown): Promise<void> => {
            await mirrorUser(db, created);
          },
        },
      },
    },
    plugins: buildPlugins(options, db),
  });
  // Narrowed to the shelf surface: handler mounting plus session reads.
  return auth;
}

async function resolveAuthUser(
  shelf: ShelfAuthInstance,
  db: DatabaseAdapter,
  request: Request,
): Promise<AuthUser | null> {
  const result = await shelf.api.getSession({ headers: request.headers });
  if (!result?.user) {
    return null;
  }
  const stored = await new UserModel(db).get(result.user.id);
  // Disabled accounts lose their sessions immediately (no cookie cache, so
  // this check runs on every request). A missing row is a mirror-race, not
  // a disable: keep the member fallback.
  if (stored?.disabled) {
    return null;
  }
  // Refresh IdP-sourced profile fields on drift only (writes are rare: just
  // when the provider profile changes). The user-edited display name lives
  // in displayNameOverride and is never clobbered.
  if (
    stored &&
    (stored.name !== result.user.name ||
      stored.email !== result.user.email ||
      (stored.avatarUrl ?? null) !== (result.user.image ?? null))
  ) {
    await db.update(db.tables.users, stored.id, {
      name: result.user.name,
      email: result.user.email,
      avatarUrl: result.user.image ?? null,
    });
  }
  return toAuthUser(
    {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      image: result.user.image,
    },
    stored?.role ?? "member",
    stored?.displayNameOverride ?? null,
  );
}

async function revokeSession(
  db: DatabaseAdapter,
  shelf: ShelfAuthInstance,
  sessionToken: string,
): Promise<void> {
  if (sessionToken === "") {
    return;
  }
  // Table delete by raw token (accepts the signed cookie value): row removal
  // invalidates the cookie since session reads are DB-backed with no cache.
  await deleteSessionByToken(db, sessionToken);
  await shelf.api
    .signOut({ headers: new Headers({ cookie: `${SESSION_COOKIE}=${sessionToken}` }) })
    .catch(() => {}); // Intentionally empty — table delete above is the revocation
}

async function setUserDisabled(
  db: DatabaseAdapter,
  userId: string,
  disabled: boolean,
): Promise<void> {
  await db.update(db.tables.users, userId, { disabled });
  if (disabled) {
    await deleteUserSessions(db, userId);
  }
}

/** Auth singleton: session reads, revocation, invites, and descriptors. */
function buildAdapter(
  shelf: ShelfAuthInstance,
  db: DatabaseAdapter,
  options: ShelfAuthOptions,
): Auth {
  return {
    handler: async (request: Request): Promise<Response> => await shelf.handler(request),
    loginMethods: (): EngineLoginMethod[] => describeLoginMethods(options),
    // eslint-disable-next-line require-await -- Auth.setup is async; validation is sync
    setup: async () => {
      // Better Auth merely warns on short secrets; the shelf fails fast
      // (32 chars ≈ 128+ bits for generated values; forgeable cookies else).
      if (options.secret.length < 32) {
        throw new Error("Shelf auth requires a secret of at least 32 characters");
      }
    },
    issueInvite: async (input) => await issueInvite(db, input),
    verifyInvite: async (input) => await verifyInvite(db, input),
    acceptInvite: async (input) => {
      const user = await acceptInvite(db, input);
      return { ...user, providerId: ENGINE_PROVIDER_ID };
    },
    passkeysEnabled: () => options.passkeys !== undefined,
    listSessions: async (userId) => await listUserSessions(db, userId),
    listPasskeys: async (userId) => await listUserPasskeys(db, userId),
    hasPassword: async (userId) => await hasPasswordCredential(db, userId),
    setDisabled: async (userId, disabled) => {
      await setUserDisabled(db, userId, disabled);
    },
    check: async (request: Request): Promise<AuthUser | null> =>
      await resolveAuthUser(shelf, db, request),
    // eslint-disable-next-line require-await -- interface is async; minting forbidden by design
    createSession: async (): Promise<string> => {
      throw new Error(
        "Shelf auth sessions are minted by engine endpoints only; mount auth.handler at /api/auth/*.",
      );
    },
    destroySession: async (sessionToken: string): Promise<void> => {
      await revokeSession(db, shelf, sessionToken);
    },
  };
}

/**
 * Create the shelf auth engine over any DatabaseAdapter.
 *
 * Returns the raw instance (mount `auth.handler`, call `auth.api.*`) plus
 * the Auth singleton (check/destroySession, invites, descriptors).
 */
export function createShelfAuth(options: ShelfAuthOptions): ShelfAuth {
  const { db } = options;
  // Fail fast at boot (login descriptors and plugin paths are fixed at creation).
  describeLoginMethods(options);
  assertNoReservedEndpointCollision(options.plugins);
  const shelf = buildAuthInstance(options, db);
  return { auth: shelf, adapter: buildAdapter(shelf, db, options) };
}
