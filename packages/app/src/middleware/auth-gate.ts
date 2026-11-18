import type { Auth } from "@storyshelf/core/auth";
import type { AuthUser } from "@storyshelf/core/types";
import { STORYBOOK_READ_PREFIX, STORYBOOK_TOKEN_PREFIX } from "@storyshelf/core/utils";
import type { Context, Next } from "hono";
import {
  ANONYMOUS_CACHE_CONTROL,
  anonymousRead,
  type AnonymousRead,
} from "../routers/anonymous-read.ts";
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

/** A project's own address, which redirects to its first page (and so to sign-in) itself. */
const PROJECT_HOME = /^\/projects\/[^/]+\/?$/u;

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
 * their token alone (ADR 0007, ADR 0051). A visitor's read of a public build's pages passes, marked
 * `private, no-cache`, and any other build of a project that has one is the standard 404, exactly
 * as a missing build (`anonymousRead`, #1172).
 */
export function authGate() {
  // oxlint-disable-next-line typescript/no-invalid-void-type -- Hono middleware may not return Response
  return async (c: Context, next: Next): Promise<Response | void> => {
    const decision = await gateDecision(c);
    if (decision === "hidden") {
      return c.notFound();
    }
    if (decision === "sign-in") {
      return toLogin(c);
    }
    await next();
    if (decision === "read") {
      c.header("Cache-Control", ANONYMOUS_CACHE_CONTROL);
    }
  };
}

/**
 * What the gate does with a request: let it `pass`, let a visitor `read` a public build (ADR 0011,
 * #1172; the one resolver decides), answer the standard 404 (`hidden`), or ask to `sign-in`.
 */
async function gateDecision(c: Context): Promise<"pass" | AnonymousRead> {
  if (passes(c.req.path)) {
    return "pass";
  }
  const anonymous = await anonymousRead(c);
  if (anonymous !== "sign-in") {
    return anonymous;
  }
  return PROJECT_HOME.test(c.req.path) ? "pass" : "sign-in";
}

/** Whether the request goes on as it is: no sign-in, a signed-in user, or a path that decides. */
function passes(path: string): boolean {
  const { user, authEnabled } = getStore();
  return !authEnabled || user !== null || isExempt(path);
}

/** Send a visitor to sign in (an HTMX request is told to navigate there). */
function toLogin(c: Context): Response {
  const login = loginPathFor(c);
  if (c.req.header("HX-Request") === "true") {
    c.header("HX-Redirect", login);
    return c.body(null, 204);
  }
  return c.redirect(login, 302);
}

/** Paths that answer for themselves: the API, sign-in, assets, token URLs and published Storybooks. */
function isExempt(path: string): boolean {
  return (
    path.startsWith("/api/") ||
    path.startsWith("/auth/") ||
    path.startsWith("/assets/") ||
    path.startsWith(STORYBOOK_TOKEN_PREFIX) ||
    path.startsWith(STORYBOOK_READ_PREFIX) ||
    path.startsWith("/.well-known/") ||
    PUBLISHED_STORYBOOK.test(path) ||
    SHORT_LINK.test(path)
  );
}
