import type { Context, MiddlewareHandler } from "hono";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyGenerator?: (c: Context) => string;
}

/** Direct peer IP from server runtimes exposing the socket (unspoofable TCP source). */
function peerIp(c: Pick<Context, "env">): string | undefined {
  const env = (c.env ?? {}) as {
    incoming?: { socket?: { remoteAddress?: unknown } };
    server?: { incoming?: { socket?: { remoteAddress?: unknown } } };
  };
  const address =
    env.incoming?.socket?.remoteAddress ?? env.server?.incoming?.socket?.remoteAddress;
  return typeof address === "string" && address ? address : undefined;
}

/**
 * Rate-limit identity for one bucket prefix: direct peer first, then the
 * first `X-Forwarded-For` entry (client-controlled, so only a fallback),
 * then `X-Real-IP`, then a shared bucket. Deployments behind proxies with
 * many users behind one peer IP share that peer's budget.
 */
export function rateLimitKey(prefix: string): (c: Context) => string {
  return (c) => {
    const peer = peerIp(c);
    if (peer) {
      return `${prefix}:${peer}`;
    }
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) {
      return `${prefix}:fwd:${forwarded}`;
    }
    const real = c.req.header("x-real-ip")?.trim();
    if (real) {
      return `${prefix}:fwd:${real}`;
    }
    return `${prefix}:anonymous`;
  };
}

/** Cap tracked buckets (spoofed keys would otherwise grow the map forever). */
const MAX_BUCKETS = 10_000;
const SWEEP_INTERVAL_MS = 60_000;

/**
 * Create a rate limiter with its own bucket store, so each app instance
 * counts independently. Limiters built from the same `rateLimit` factory that
 * resolve to the same key share one counter (e.g. `/api/v1/*` and
 * `/api/v1/tokens/*` both bill the caller's `api:` bucket).
 */
export function createRateLimiter(): (options: RateLimitOptions) => MiddlewareHandler {
  const stores = new Map<string, RateLimitEntry>();
  let lastSweep = Date.now();

  const sweep = (now: number): void => {
    lastSweep = now;
    for (const [key, entry] of stores) {
      if (now > entry.resetAt) {
        stores.delete(key);
      }
    }
  };

  return (options) => {
    const { windowMs, max, keyGenerator } = options;
    return async (c, next) => {
      const key = keyGenerator ? keyGenerator(c) : rateLimitKey("api")(c);
      const now = Date.now();
      if (now - lastSweep > SWEEP_INTERVAL_MS) {
        sweep(now);
      }
      let entry = stores.get(key);
      if (!entry || now > entry.resetAt) {
        entry = { count: 0, resetAt: now + windowMs };
        if (stores.size >= MAX_BUCKETS) {
          const oldest = stores.keys().next();
          if (!oldest.done) {
            stores.delete(oldest.value);
          }
        }
        stores.set(key, entry);
      }
      entry.count += 1;
      if (entry.count > max) {
        c.header("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
        return c.json({ error: "Too many requests" }, 429);
      }
      c.header("X-RateLimit-Limit", String(max));
      c.header("X-RateLimit-Remaining", String(Math.max(0, max - entry.count)));
      return await next();
    };
  };
}
