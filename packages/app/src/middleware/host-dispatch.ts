import { classifyHost, hostingOriginsOfConfig } from "@storyshelf/core/config";
import type { Context, Next } from "hono";
import { refuseHost, serveAliasHost, serveContentHost } from "../routers/content-host.ts";
import { getStore } from "../store.ts";

/**
 * Host dispatch of `subdomain` hosting (ADR 0051, decision 5). Mounted inside the request store and
 * before every access gate, so a content or alias host never reaches a portal route. The `Host` is
 * only ever compared with the hosts derived from the configured portal origin and base domain: the
 * portal continues, a content host serves its one build, an alias host redirects to the portal, and
 * anything else (an IP, an unknown name, a reserved label, a second label) is the identical 404. In
 * any other mode this is a no-op. `X-Forwarded-*` headers are never read.
 */
export function hostDispatch() {
  // oxlint-disable-next-line typescript/no-invalid-void-type -- Hono middleware may not return Response
  return async (c: Context, next: Next): Promise<Response | void> => {
    const origins = hostingOriginsOfConfig(getStore().config);
    if (origins === undefined) {
      await next();
      return;
    }
    const host = classifyHost(new URL(c.req.url).host, origins);
    switch (host.kind) {
      case "portal":
        await next();
        return;
      case "content":
        return await serveContentHost(c, origins, host.buildId);
      case "alias":
        return serveAliasHost(c, origins, host.slug);
      default:
        return refuseHost(c);
    }
  };
}
