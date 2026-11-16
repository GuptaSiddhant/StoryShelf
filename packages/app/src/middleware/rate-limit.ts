import type { Context, MiddlewareHandler } from "hono";
import { jsonRefusal } from "./api-errors.ts";
import { createClientIpResolver, type ClientIpResolver } from "./client-ip.ts";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyGenerator?: (c: Context) => string;
}

/** The resolver for an app without `trustProxy`: the socket peer, else the unverified fallback. */
const defaultClientIp = createClientIpResolver();

/**
 * Rate-limit identity for one bucket prefix, from the app's client-IP resolver
 * (`createClientIpResolver(config.trustProxy)`): `<prefix>:<ip>` for the peer or a client named
 * by a trusted proxy, `<prefix>:fwd:<ip>` for the unverified fallback (no socket, no
 * `trustProxy`), else one shared `<prefix>:anonymous` bucket. Without `trustProxy`, every client
 * behind a load balancer shares the proxy's bucket.
 */
export function rateLimitKey(
  prefix: string,
  clientIp: ClientIpResolver = defaultClientIp,
): (c: Context) => string {
  return (c) => {
    const client = clientIp(c);
    if (!client) {
      return `${prefix}:anonymous`;
    }
    return client.source === "unverified" ? `${prefix}:fwd:${client.ip}` : `${prefix}:${client.ip}`;
  };
}

/** Cap tracked buckets (spoofed keys would otherwise grow the map forever). */
const MAX_BUCKETS = 10_000;
const SWEEP_INTERVAL_MS = 60_000;

function sweepExpired(stores: Map<string, RateLimitEntry>, now: number): void {
  for (const [key, entry] of stores) {
    if (now > entry.resetAt) {
      stores.delete(key);
    }
  }
}

function evictOldest(stores: Map<string, RateLimitEntry>): void {
  const oldest = stores.keys().next();
  if (!oldest.done) {
    stores.delete(oldest.value);
  }
}

/** Start a fresh bucket for `key` that resets at `resetAt`, evicting the oldest one at the cap. */
function openBucket(
  stores: Map<string, RateLimitEntry>,
  key: string,
  resetAt: number,
): RateLimitEntry {
  const entry = { count: 0, resetAt };
  if (stores.size >= MAX_BUCKETS) {
    evictOldest(stores);
  }
  stores.set(key, entry);
  return entry;
}

/** A bucket store with its own sweep clock: `bucketFor(key, now, windowMs)` is the live bucket of `key`. */
function createBucketStore(): (key: string, now: number, windowMs: number) => RateLimitEntry {
  const stores = new Map<string, RateLimitEntry>();
  let lastSweep = Date.now();

  // An expired or missing bucket is replaced (evicting the oldest at the cap).
  return (key, now, windowMs) => {
    if (now - lastSweep > SWEEP_INTERVAL_MS) {
      lastSweep = now;
      sweepExpired(stores, now);
    }
    const existing = stores.get(key);
    if (existing && now <= existing.resetAt) {
      return existing;
    }
    return openBucket(stores, key, now + windowMs);
  };
}

/** Count this request and set the headers; the 429 answer when `entry` is over `max`, else undefined. */
function applyLimit(
  c: Context,
  entry: RateLimitEntry,
  max: number,
  now: number,
): Response | undefined {
  entry.count += 1;
  if (entry.count > max) {
    c.header("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
    return jsonRefusal(c, 429, "Too many requests");
  }
  c.header("X-RateLimit-Limit", String(max));
  c.header("X-RateLimit-Remaining", String(Math.max(0, max - entry.count)));
  return undefined;
}

/**
 * Create a rate limiter with its own bucket store, so each app instance
 * counts independently. Limiters built from the same `rateLimit` factory that
 * resolve to the same key share one counter (e.g. `/api/v1/*` and
 * `/api/v1/tokens/*` both bill the caller's `api:` bucket). `clientIp` names the caller
 * (`createClientIpResolver(config.trustProxy)`).
 */
export function createRateLimiter(
  clientIp: ClientIpResolver = defaultClientIp,
): (options: RateLimitOptions) => MiddlewareHandler {
  const bucketFor = createBucketStore();
  const defaultKey = rateLimitKey("api", clientIp);

  return (options) => {
    const { windowMs, max, keyGenerator } = options;
    return async (c, next) => {
      const key = keyGenerator ? keyGenerator(c) : defaultKey(c);
      const now = Date.now();
      const limited = applyLimit(c, bucketFor(key, now, windowMs), max, now);
      if (!limited) {
        await next();
      }
      return limited;
    };
  };
}
