import type { TrustProxy } from "@storyshelf/core/config";
import type { Context } from "hono";
import { createClientIpResolver, type ClientIpResolver } from "../middleware/client-ip.ts";
import { getStore } from "../store.ts";

/** The header the engine reads its client address from (`advanced.ipAddress.ipAddressHeaders`). */
export const ENGINE_CLIENT_HEADER = "x-forwarded-for";

const resolvers = new Map<string, ClientIpResolver>();

/** The resolver for this `trustProxy` setting: the same rules as the app's own rate-limit buckets. */
function resolverFor(trust: TrustProxy | undefined): ClientIpResolver {
  const key = JSON.stringify(trust ?? null);
  const known = resolvers.get(key);
  if (known) {
    return known;
  }
  const created = createClientIpResolver(trust);
  resolvers.set(key, created);
  return created;
}

/**
 * Set the engine's client header to the address the server resolved, replacing whatever the caller
 * sent. One value, never copied from the request: with nothing resolved the header is removed, so a
 * caller cannot choose the engine's rate-limit key or the IP stored on its session.
 */
export function setEngineClient(c: Context, headers: Headers): void {
  const client = resolverFor(getStore().config.trustProxy)(c);
  if (client) {
    headers.set(ENGINE_CLIENT_HEADER, client.ip);
  } else {
    headers.delete(ENGINE_CLIENT_HEADER);
  }
}

/** The incoming request with its client header replaced by the resolved address (the `/api/auth/*` mount). */
export function requestForEngine(c: Context): Request {
  const headers = new Headers(c.req.raw.headers);
  setEngineClient(c, headers);
  return new Request(c.req.raw, { headers });
}
