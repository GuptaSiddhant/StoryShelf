import type { Context, Next } from "hono";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyGenerator?: (c: Context) => string;
}

const stores = new Map<string, RateLimitEntry>();

function cleanup(): void {
  const now = Date.now();
  for (const [key, entry] of stores) {
    if (now > entry.resetAt) {
      stores.delete(key);
    }
  }
}

setInterval(cleanup, 60_000).unref();

/** Hono middleware limiting requests per key within a sliding window. */
export function rateLimit(options: RateLimitOptions) {
  const { windowMs, max, keyGenerator } = options;
  // oxlint-disable-next-line typescript/no-invalid-void-type -- Hono middleware may not return Response
  return async (c: Context, next: Next): Promise<Response | void> => {
    const key = keyGenerator ? keyGenerator(c) : (c.req.header("x-forwarded-for") ?? "anonymous");
    const now = Date.now();
    let entry = stores.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      stores.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "Too many requests" }, 429);
    }
    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(Math.max(0, max - entry.count)));
    await next();
  };
}
