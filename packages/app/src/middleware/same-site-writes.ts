import { hostingOriginsOfConfig, portalOriginOf, type ShelfConfig } from "@storyshelf/core/config";
import { readSessionCookie } from "@storyshelf/core/types";
import type { Context, Next } from "hono";
import { jsonRefusal } from "./api-errors.ts";

/** Methods that change state. */
const WRITES: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Sign-in and sign-up writes. They are judged even with no session cookie: a cross-site form that signs
 * the victim in as the attacker (login CSRF) arrives before any cookie exists.
 */
const SIGN_IN_PATHS = /^\/(?:auth\/engine\/login|api\/auth\/sign-(?:in|up)(?:\/.*)?)$/u;

/** What the refusal tells the caller: it names the rule, not the request. */
export const CROSS_SITE_WRITE_MESSAGE =
  "This request did not come from this site, so it was refused. Open the page again and retry.";

/**
 * The origin a write must come from (ADR 0051, decision 9): the portal's. In `subdomain` mode that is
 * the configured portal origin, never anything a content host could say; otherwise the configured
 * `publicBaseUrl`, else the origin the request itself was addressed to.
 */
function portalOrigin(
  config: Pick<ShelfConfig, "publicBaseUrl" | "storybookHosting" | "publishedBaseDomain">,
  c: Context,
): string {
  const origins = hostingOriginsOfConfig(config);
  if (origins) {
    return portalOriginOf(origins);
  }
  return new URL(config.publicBaseUrl ?? c.req.url).origin;
}

/**
 * Whether the request comes from the portal itself: its `Origin` is the portal origin, or the browser
 * says `Sec-Fetch-Site: same-origin` (the portal's own page) or `none` (the user typed or bookmarked it).
 * `same-site` is not enough: a content host is the same site as the portal, and its pages are uploaded
 * by whoever can upload.
 */
function fromPortal(c: Context, origin: string): boolean {
  const site = c.req.header("sec-fetch-site");
  return site === "same-origin" || site === "none" || c.req.header("origin") === origin;
}

/**
 * The write rule of ADR 0051, decision 9: a state-changing request that carries a session cookie is
 * refused with `403` unless it comes from the portal. It covers every path, `/api/v1` included
 * (`CSRF_PATHS` guards page routes only), and exists because `SameSite=Lax` still sends the session
 * cookie on a same-site request, and every content host is the same site as the portal. A request
 * without a session cookie (a bearer-token client, an anonymous form) is not this rule's concern,
 * except sign-in and sign-up (`SIGN_IN_PATHS`), which close login CSRF.
 */
export function sameSiteWrites(config: ShelfConfig) {
  // oxlint-disable-next-line typescript/no-invalid-void-type -- Hono middleware may not return Response
  return async (c: Context, next: Next): Promise<Response | void> => {
    const judged =
      readSessionCookie(c.req.header("cookie")) !== undefined || SIGN_IN_PATHS.test(c.req.path);
    if (!WRITES.has(c.req.method) || !judged || fromPortal(c, portalOrigin(config, c))) {
      await next();
      return;
    }
    return c.req.path.startsWith("/api/")
      ? jsonRefusal(c, 403, CROSS_SITE_WRITE_MESSAGE)
      : c.text(CROSS_SITE_WRITE_MESSAGE, 403);
  };
}
