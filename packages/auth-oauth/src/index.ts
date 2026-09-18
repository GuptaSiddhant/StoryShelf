import {
  SESSION_COOKIE,
  type AuthAdapter,
  type AuthCallback,
  type AuthUser,
} from "@storyshelf/core/adapter/auth";
import { createHmac, timingSafeEqual } from "node:crypto";

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

/** Cached endpoint discovery with a static fallback. */
function createEndpointDiscovery(options: OAuthAuthOptions): {
  current: () => OidcEndpoints;
  resolve: () => Promise<OidcEndpoints>;
  warm: () => Promise<void>;
} {
  let discovered: OidcEndpoints | null = null;
  const current = (): OidcEndpoints => discovered ?? staticEndpoints(options);
  const resolve = async (): Promise<OidcEndpoints> =>
    await resolveEndpoints(options, (fresh) => {
      discovered = fresh;
    });
  return {
    current,
    resolve,
    warm: async () => {
      await resolve();
    },
  };
}

/** Cookie session handlers bound to the signing secret. */
function createSessionHandlers(secret: string): {
  check: (request: Request) => Promise<AuthUser | null>;
  createSession: (user: AuthUser) => Promise<string>;
} {
  // Async is required by the AuthAdapter interface, though the logic is synchronous.
  // eslint-disable-next-line require-await
  const check = async (request: Request): Promise<AuthUser | null> => {
    const token = readCookie(request, SESSION_COOKIE);
    if (!token) {
      return null;
    }
    const payload = verifyPayload(secret, token);
    if (!payload || payload.expiresAt <= Date.now()) {
      return null;
    }
    return toUser(payload);
  };
  // eslint-disable-next-line require-await
  const createSession = async (user: AuthUser): Promise<string> => {
    const payload: SessionPayload = {
      userId: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: user.role,
      groups: user.groups,
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    return signPayload(secret, payload);
  };
  return { check, createSession };
}

/** Options for configuring an OAuth/OIDC auth adapter. */
export interface OAuthAuthOptions {
  /** OIDC issuer base URL. */
  issuer: string;
  /** OAuth client ID. */
  clientId: string;
  /** OAuth client secret. */
  clientSecret: string;
  /** Secret used to sign and verify session cookies. */
  secret: string;
  /** Redirect URL registered with the OIDC provider. */
  redirectUrl: string;
  /** Optional OAuth scopes. Defaults to `openid`, `email`, `profile`. */
  scopes?: string[];
  /**
   * OIDC Discovery document URL. Defaults to
   * `{issuer}/.well-known/openid-configuration`. Set to `null` to disable
   * discovery entirely (explicit endpoints or Keycloak layout are used).
   */
  discoveryUrl?: string | null;
  /** Explicit endpoint overrides (skip discovery for these). */
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
  /**
   * Claim names read for group memberships, in order. Defaults to
   * `["groups", "cognito:groups"]`. Values are normalized to strings.
   */
  groupClaims?: string[];
  /** Groups (names or provider IDs) granting the site `admin` role. Exact match. */
  adminGroups?: string[];
  /** Groups (names or provider IDs) granting the site `viewer` role. Exact match. */
  viewerGroups?: string[];
}

/** Resolved OIDC endpoints for one provider. */
export interface OidcEndpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
}

/** Shared options every provider preset accepts. */
export interface PresetBaseOptions {
  clientId: string;
  clientSecret: string;
  secret: string;
  redirectUrl: string;
  scopes?: string[];
  groupClaims?: string[];
  adminGroups?: string[];
  viewerGroups?: string[];
}

/** Auth adapter that authenticates against an OAuth/OIDC provider. */
export interface OAuthAuth extends AuthAdapter {
  /** Build the provider authorization URL for a login flow with the given anti-CSRF `state`. */
  loginUrl(state: string): string;
}

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

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role: AuthUser["role"];
  groups?: string[];
  expiresAt: number;
}

interface TokenResponse {
  access_token?: string;
}

interface UserInfoResponse {
  sub?: string;
  email?: string;
  name?: string;
  picture?: string;
}

/** Keycloak endpoint layout (the historic default). */
function keycloakEndpoints(issuer: string): OidcEndpoints {
  return {
    authorizationEndpoint: `${issuer}/protocol/openid-connect/auth`,
    tokenEndpoint: `${issuer}/protocol/openid-connect/token`,
    userinfoEndpoint: `${issuer}/protocol/openid-connect/userinfo`,
  };
}

/** Endpoints from explicit overrides, falling back to the Keycloak layout. */
function staticEndpoints(options: OAuthAuthOptions): OidcEndpoints {
  const legacy = keycloakEndpoints(options.issuer);
  return {
    authorizationEndpoint: options.authorizationEndpoint ?? legacy.authorizationEndpoint,
    tokenEndpoint: options.tokenEndpoint ?? legacy.tokenEndpoint,
    userinfoEndpoint: options.userinfoEndpoint ?? legacy.userinfoEndpoint,
  };
}

interface DiscoveryDocument {
  authorization_endpoint?: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
}

/** Merge discovered endpoints over explicit overrides and the static fallback. */
function mergeDiscovered(
  options: OAuthAuthOptions,
  fallback: OidcEndpoints,
  document: DiscoveryDocument,
): OidcEndpoints {
  return {
    authorizationEndpoint:
      options.authorizationEndpoint ??
      document.authorization_endpoint ??
      fallback.authorizationEndpoint,
    tokenEndpoint: options.tokenEndpoint ?? document.token_endpoint ?? fallback.tokenEndpoint,
    userinfoEndpoint:
      options.userinfoEndpoint ?? document.userinfo_endpoint ?? fallback.userinfoEndpoint,
  };
}

/** Fetch and parse an OIDC Discovery document, or null when unavailable. */
async function fetchDiscovery(documentUrl: string): Promise<DiscoveryDocument | null> {
  try {
    const response = await fetch(documentUrl);
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as DiscoveryDocument;
  } catch {
    return null;
  }
}

/** Resolve endpoints via OIDC Discovery, caching into `onDiscovered`. */
async function resolveEndpoints(
  options: OAuthAuthOptions,
  onDiscovered: (endpoints: OidcEndpoints) => void,
): Promise<OidcEndpoints> {
  const fallback = staticEndpoints(options);
  const discoveryUrl =
    options.discoveryUrl === undefined
      ? `${options.issuer}/.well-known/openid-configuration`
      : options.discoveryUrl;
  if (discoveryUrl === null) {
    return fallback;
  }
  const document = await fetchDiscovery(discoveryUrl);
  if (!document) {
    return fallback;
  }
  const resolved = mergeDiscovered(options, fallback, document);
  onDiscovered(resolved);
  return resolved;
}

/** Throw when the provider replaced group claims with an overage pointer. */
function assertNoGroupOverage(record: Record<string, unknown>): void {
  if (typeof record["_claim_names"] === "object" && record["_claim_names"] !== null) {
    throw new Error(
      "Identity provider omitted group claims (overage). Restrict the groups emitted for this app or query the provider directory directly.",
    );
  }
}

/** Append deduped string values from one claim. */
function collectClaimGroups(record: Record<string, unknown>, claim: string, into: string[]): void {
  const raw = record[claim];
  if (!Array.isArray(raw)) {
    return;
  }
  for (const value of raw) {
    if (typeof value === "string" && !into.includes(value)) {
      into.push(value);
    }
  }
}

/** Extract group memberships from the configured claims (deduped, order kept). */
function extractGroups(info: UserInfoResponse, claimNames: string[]): string[] {
  const record = info as Record<string, unknown>;
  assertNoGroupOverage(record);
  const groups: string[] = [];
  for (const claim of claimNames) {
    collectClaimGroups(record, claim, groups);
  }
  return groups;
}

/** Resolve the site role from group membership (exact match). */
function roleForGroups(groups: string[], options: OAuthAuthOptions): AuthUser["role"] {
  const adminGroups = options.adminGroups ?? [];
  if (groups.some((group) => adminGroups.includes(group))) {
    return "admin";
  }
  const viewerGroups = options.viewerGroups ?? [];
  if (groups.some((group) => viewerGroups.includes(group))) {
    return "viewer";
  }
  return "member";
}

function hmacHex(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function equalStrings(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function encodePayload(payload: SessionPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodePayload(body: string): SessionPayload | null {
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
}

function signPayload(secret: string, payload: SessionPayload): string {
  const body = encodePayload(payload);
  return `${body}.${hmacHex(secret, body)}`;
}

function verifyPayload(secret: string, token: string): SessionPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot === -1) {
    return null;
  }
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!equalStrings(hmacHex(secret, body), signature)) {
    return null;
  }
  return decodePayload(body);
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      continue;
    }
    if (part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}

function toUser(payload: SessionPayload): AuthUser {
  return {
    id: payload.userId,
    email: payload.email,
    name: payload.name,
    avatarUrl: payload.avatarUrl,
    role: payload.role,
    groups: payload.groups,
  };
}

function buildLoginUrl(
  endpoints: OidcEndpoints,
  options: OAuthAuthOptions,
  scopes: string[],
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUrl,
    response_type: "code",
    scope: scopes.join(" "),
    state,
  });
  return `${endpoints.authorizationEndpoint}?${params.toString()}`;
}

async function exchangeCode(
  endpoints: OidcEndpoints,
  options: OAuthAuthOptions,
  code: string,
): Promise<string | null> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: options.clientId,
    client_secret: options.clientSecret,
    redirect_uri: options.redirectUrl,
  });
  const response = await fetch(endpoints.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as TokenResponse;
  return data.access_token ?? null;
}

async function fetchUserInfo(
  endpoints: OidcEndpoints,
  options: OAuthAuthOptions,
  accessToken: string,
): Promise<AuthUser | null> {
  const response = await fetch(endpoints.userinfoEndpoint, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    return null;
  }
  const info = (await response.json()) as UserInfoResponse;
  if (!info.sub) {
    return null;
  }
  const groups = extractGroups(info, options.groupClaims ?? ["groups", "cognito:groups"]);
  return {
    id: info.sub,
    email: info.email ?? "",
    name: info.name ?? info.email ?? info.sub,
    avatarUrl: info.picture,
    role: roleForGroups(groups, options),
    groups,
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
