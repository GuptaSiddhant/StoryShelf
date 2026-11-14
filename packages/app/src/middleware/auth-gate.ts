import type { Auth } from "@storyshelf/core/auth";
import type { AuthUser } from "@storyshelf/core/types";
import { STORYBOOK_READ_PREFIX, STORYBOOK_TOKEN_PREFIX } from "@storyshelf/core/utils";
import type { Context, Next } from "hono";
import { safeReturnPath } from "../routers/oauth-state.ts";
import { getStore } from "../store.ts";

/** Resolve the request user from the auth adapter (null when auth is off or a token is used). */
export async function resolveRequestUser(
  c: Pick<Context, "req">,
  auth?: Auth,
): Promise<AuthUser | null> {
  if (!auth) {
    return null;
  }
  if (c.req.header("authorization")) {
    return null;
  }
  return await auth.check(c.req.raw);
}

/**
 * The published-Storybook routes, which enforce their own auth. Only a `storybook` segment right
 * after the project counts: a `/storybook` anywhere else in a path (a wildcard tail of a component
 * or label page, with a query naming another page) must not open the gate.
 */
const PUBLISHED_STORYBOOK = /^\/projects\/[^/]+\/storybook(?:\/|$)/u;

/**
 * Short links to a published Storybook (`/_/<build id or project slug>/...`). The handler decides
 * access itself (a public build opens, anything else answers like a private one), so a signed-out
 * visitor with a link to a public build is not sent to login first (ADR 0011). Anchored: `/_s/` is
 * the signed-URL prefix and `/_/` alone is not a link.
 */
const SHORT_LINK = /^\/_\/[^/]+(?:\/|$)/u;

/** The login page, told to bring the visitor back to the page they asked for (same-origin only). */
function loginPathFor(c: Pick<Context, "req">): string {
  const url = new URL(c.req.url);
  const back = safeReturnPath(`${url.pathname}${url.search}`, "/");
  return `/auth/login?return_to=${encodeURIComponent(back)}`;
}

/**
 * Gate the server-rendered UI behind auth (ADR 0008): unauthenticated HTML
 * requests redirect to login. API/auth routes answer 401/403 themselves, and
 * published-Storybook routes enforce their own auth (public builds are
 * viewable without a session, ADR 0011), and `/_s/<token>` and `/_r/<token>` are answered by
 * their token alone (ADR 0007, ADR 0051).
 */
export function authGate() {
  // oxlint-disable-next-line typescript/no-invalid-void-type -- Hono middleware may not return Response
  return async (c: Context, next: Next): Promise<Response | void> => {
    const { user, authEnabled: isAuthEnabled } = getStore();
    const { path } = c.req;
    if (
      !isAuthEnabled ||
      user ||
      path.startsWith("/api/") ||
      path.startsWith("/auth/") ||
      path.startsWith("/assets/") ||
      path.startsWith(STORYBOOK_TOKEN_PREFIX) ||
      path.startsWith(STORYBOOK_READ_PREFIX) ||
      path.startsWith("/.well-known/") ||
      PUBLISHED_STORYBOOK.test(path) ||
      SHORT_LINK.test(path) ||
      /^\/projects\/[^/]+\/?$/u.test(path)
    ) {
      await next();
      return;
    }
    const login = loginPathFor(c);
    if (c.req.header("HX-Request") === "true") {
      c.header("HX-Redirect", login);
      return c.body(null, 204);
    }
    return c.redirect(login, 302);
  };
}
