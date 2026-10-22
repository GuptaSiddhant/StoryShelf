/**
 * The deployment's public origin (ADR 0007, decision 6): one resolver for anything that needs an
 * absolute URL in the background (commit-status links, email links, signed Storybook URLs).
 * It tries `config.publicBaseUrl`, then the platform's own address from the environment, then the
 * origin an admin's browser reported and an admin confirmed. A reported origin nobody confirmed is
 * only a suggestion: `resolve()` and `url()` do not return it, so no link, notification or signed
 * URL is built on it. The `Host` of a request is never used for those: a background job has none,
 * and it can be forged to plant links in emails and commit statuses.
 *
 * The one exception is authentication (OAuth redirect URIs, the OIDC helper): those routes are
 * interactive and request-bound, so {@link PublicOriginResolver.authOrigin} may answer with the
 * request's own origin when no origin is confirmed.
 */
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { ShelfConfig } from "../config.ts";
import { detectPublicBaseUrl, normalizeOrigin, type Env } from "../utils/public-origin.ts";
import { SiteSettingsModel } from "./site-settings.ts";

/** Key of the stored origin in `site_settings`. */
export const PUBLIC_ORIGIN_KEY = "public_origin";

/** Where the resolved origin came from. */
export type PublicOriginSource = "config" | "platform" | "admin";

/** An origin that may be used, and its provenance. */
export interface ResolvedPublicOrigin {
  /** Base URL without a trailing slash. */
  url: string;
  source: PublicOriginSource;
}

/** The origin an admin's browser reported, as stored. */
export interface StoredPublicOrigin {
  origin: string;
  confirmed: boolean;
}

/** Resolves the public origin; reads the database at most once per `ttlMs`. */
export interface PublicOriginResolver {
  /**
   * The origin background code may use now, or `null` when nothing is confirmed: a configured or
   * platform origin, or one an admin confirmed. A detected, unconfirmed origin never resolves.
   */
  resolve(): Promise<ResolvedPublicOrigin | null>;
  /** Shorthand for `resolve()` when only the URL matters. */
  url(): Promise<string | undefined>;
  /**
   * The origin for an interactive authentication route (OAuth redirect URI, OIDC helper): the
   * resolved origin, else `requestOrigin`, the address the request itself came in on. Never use
   * it for a link that outlives the request.
   */
  authOrigin(requestOrigin: string): Promise<string>;
  /** The value the System page shows and edits; `null` when no browser reported one. */
  stored(): Promise<StoredPublicOrigin | null>;
  /**
   * An admin's browser reported `origin`. First report wins: nothing is stored when a value already
   * is, so a visit through another domain cannot replace a confirmed origin. Returns what is stored.
   */
  report(origin: string, userId?: string): Promise<StoredPublicOrigin>;
  /** An admin confirmed or entered `origin`: it replaces whatever is stored. */
  set(origin: string, userId?: string): Promise<StoredPublicOrigin>;
  /** An admin dropped the stored origin. */
  clear(): Promise<void>;
}

/** Inputs of {@link createPublicOriginResolver}. */
export interface PublicOriginOptions {
  db: DatabaseAdapter;
  /** Only `publicBaseUrl` is read. */
  config?: Pick<ShelfConfig, "publicBaseUrl"> | undefined;
  /** Environment to detect the platform from; `process.env` when absent. */
  env?: Env | undefined;
  /** How long a database read is reused (default 10 s). */
  ttlMs?: number | undefined;
}

/** Build the resolver for one app instance. */
export function createPublicOriginResolver(options: PublicOriginOptions): PublicOriginResolver {
  const store = createStoredOrigin(new SiteSettingsModel(options.db), options.ttlMs ?? 10_000);
  const resolver: PublicOriginResolver = {
    async resolve() {
      const configured = configuredBase(options.config?.publicBaseUrl);
      if (configured !== undefined) {
        return { url: configured, source: "config" };
      }
      const platform = detectPublicBaseUrl(options.env ?? process.env);
      if (platform !== undefined) {
        return { url: platform, source: "platform" };
      }
      const stored = await store.read();
      return stored?.confirmed === true ? { url: stored.origin, source: "admin" } : null;
    },
    async url() {
      return (await resolver.resolve())?.url;
    },
    async authOrigin(requestOrigin) {
      return (await resolver.url()) ?? requestOrigin;
    },
    stored: async () => await store.read(),
    report: async (origin, userId) => await store.report(origin, userId),
    set: async (origin, userId) => await store.write(origin, true, userId),
    clear: async () => {
      await store.clear();
    },
  };
  return resolver;
}

/** The stored origin behind a small read cache, shared by every method of one resolver. */
function createStoredOrigin(
  settings: SiteSettingsModel,
  ttlMs: number,
): Pick<PublicOriginResolver, "report" | "clear"> & {
  read(): Promise<StoredPublicOrigin | null>;
  write(origin: string, confirmed: boolean, userId?: string): Promise<StoredPublicOrigin>;
} {
  let cache: { at: number; value: StoredPublicOrigin | null } | undefined;
  const remember = (value: StoredPublicOrigin | null): void => {
    cache = { at: Date.now(), value };
  };
  const write = async (
    origin: string,
    confirmed: boolean,
    userId?: string,
  ): Promise<StoredPublicOrigin> => {
    const value: StoredPublicOrigin = { origin: requireOrigin(origin), confirmed };
    await settings.set(PUBLIC_ORIGIN_KEY, JSON.stringify(value), userId);
    remember(value);
    return value;
  };
  return {
    async read() {
      if (cache !== undefined && Date.now() - cache.at < ttlMs) {
        return cache.value;
      }
      const value = parseStored(await settings.get(PUBLIC_ORIGIN_KEY));
      remember(value);
      return value;
    },
    write,
    async report(origin, userId) {
      const existing = parseStored(await settings.get(PUBLIC_ORIGIN_KEY));
      remember(existing);
      return existing ?? (await write(origin, false, userId));
    },
    async clear() {
      await settings.remove(PUBLIC_ORIGIN_KEY);
      remember(null);
    },
  };
}

/** `publicBaseUrl` as a base URL: trailing slashes dropped, a path prefix kept. */
function configuredBase(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/\/+$/u, "");
  return trimmed === "" ? undefined : trimmed;
}

/** `origin` as an origin; throws unless it is an http(s) origin with no path, query or fragment. */
function requireOrigin(origin: string): string {
  const normalized = normalizeOrigin(origin);
  const url = normalized === undefined ? undefined : new URL(withScheme(origin));
  if (normalized === undefined || url?.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      "The public origin must be an http(s) origin such as https://shelf.example.com",
    );
  }
  return normalized;
}

function withScheme(value: string): string {
  const text = value.trim();
  return /^[a-z][a-z\d+.-]*:\/\//iu.test(text) ? text : `https://${text}`;
}

function parseStored(raw: string | null): StoredPublicOrigin | null {
  if (raw === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredPublicOrigin>;
    const origin = normalizeOrigin(parsed.origin);
    return origin === undefined ? null : { origin, confirmed: parsed.confirmed === true };
  } catch {
    return null;
  }
}
