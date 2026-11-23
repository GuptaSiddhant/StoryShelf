import type { Logger } from "@storyshelf/core/logger";
import { isIP } from "node:net";

/** The slice of Better Auth's `rateLimit` option the shelf sets. */
interface EngineRateLimit {
  enabled?: boolean;
  customRules: Record<
    string,
    (
      request: Request,
      current: { window: number; max: number },
    ) => { window: number; max: number } | false
  >;
}

/** The one client address the app names, or undefined when the header is missing or not a single IP. */
function namedClient(request: Request): string | undefined {
  const value = request.headers.get("x-forwarded-for")?.trim();
  return value !== undefined && isIP(value) !== 0 ? value : undefined;
}

/**
 * The engine's limiter keys each request on the address the app names in `x-forwarded-for`. A
 * request that names none would fall into one key shared by every client, which brings back the
 * lockout, so the engine's limit is skipped for it (the app's own sign-in bucket still applies) and
 * one warning is logged, with the reason only and never a header. A constant stand-in address would
 * be the same shared key, so none is used.
 */
export function engineRateLimit(enabled: boolean | null, logger: Logger | null): EngineRateLimit {
  let warned = false;
  return {
    ...(enabled === null ? {} : { enabled }),
    customRules: {
      "/**": (request, current) => {
        if (namedClient(request) !== undefined) {
          return current;
        }
        if (!warned) {
          warned = true;
          logger?.warn({ reason: "no client address" }, "engine rate limit skipped");
        }
        return false;
      },
    },
  };
}
