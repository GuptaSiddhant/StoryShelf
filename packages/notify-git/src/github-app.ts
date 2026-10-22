import { httpJson } from "@storyshelf/core/utils";
/**
 * GitHub App authentication without dependencies: an RS256 JWT signed with `node:crypto`, traded
 * for an installation token that is cached per channel until shortly before it expires.
 */
import { createHash, createSign } from "node:crypto";
import { apiBase, githubHeaders } from "./github-api.ts";

/** The App credentials of one channel. */
export interface AppCredentials {
  appId: string;
  installationId: string;
  /** The App's private key (PEM); a one-line key with literal `\n` is accepted. */
  privateKey: string;
}

/** A cached installation token is replaced this long before GitHub expires it. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

const cache = new Map<string, CachedToken>();
const inflight = new Map<string, Promise<string>>();

/** An installation token for the channel: cached, or exchanged with a fresh App JWT. */
export async function installationToken(creds: AppCredentials): Promise<string> {
  const key = cacheKey(creds);
  const cached = cache.get(key);
  if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
    return cached.token;
  }
  const pending = inflight.get(key) ?? exchange(creds, key);
  inflight.set(key, pending);
  try {
    return await pending;
  } finally {
    inflight.delete(key);
  }
}

/** Forget every cached token (tests). */
export function clearInstallationTokens(): void {
  cache.clear();
  inflight.clear();
}

async function exchange(creds: AppCredentials, key: string): Promise<string> {
  const jwt = signAppJwt(creds, Date.now());
  const response = await httpJson<{ token?: unknown; expires_at?: unknown }>(
    `${apiBase()}/app/installations/${encodeURIComponent(creds.installationId)}/access_tokens`,
    { method: "POST", headers: githubHeaders(jwt) },
  );
  if (typeof response.token !== "string" || typeof response.expires_at !== "string") {
    throw new TypeError("GitHub did not return an installation token");
  }
  cache.set(key, { token: response.token, expiresAt: Date.parse(response.expires_at) });
  return response.token;
}

/** The cache key never holds the private key itself, only its digest. */
function cacheKey(creds: AppCredentials): string {
  const digest = createHash("sha256").update(creds.privateKey).digest("hex").slice(0, 16);
  return `${creds.appId}:${creds.installationId}:${digest}`;
}

/** An App JWT (RS256), valid for nine minutes; `now` is in milliseconds. */
export function signAppJwt(creds: AppCredentials, now: number): string {
  const seconds = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // `iat` is backdated a minute to allow for clock drift, as GitHub recommends.
  const claims = base64url(
    JSON.stringify({ iat: seconds - 60, exp: seconds + 9 * 60, iss: creds.appId }),
  );
  const signature = createSign("RSA-SHA256")
    .update(`${header}.${claims}`)
    .sign(creds.privateKey.replaceAll(String.raw`\n`, "\n"));
  return `${header}.${claims}.${base64url(signature)}`;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}
