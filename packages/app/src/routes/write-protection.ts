/**
 * How every state-changing route is protected against cross-site request forgery (#786). Two layers
 * apply to a write that carries the session cookie:
 *
 * 1. **Same-origin writes** (`sameSiteWrites`, ADR 0051, decision 9): on every path, `/api/v1` and the
 *    auth engine included, a write with a session cookie is refused unless `Origin` is the portal or
 *    `Sec-Fetch-Site` is `same-origin`/`none`. Sign-in and sign-up are judged with no cookie too.
 * 2. **CSRF tokens** (`csrf`, #703): every page (form) write outside `/api/` also needs a token bound
 *    to the session, from the `x-csrf-token` header (HTMX) or the `csrf_token` field (native posts).
 *
 * A bearer-token request is never cookie-authenticated: `resolveRequestUser` ignores the session
 * whenever an `Authorization` header is present, so a bad token is refused rather than falling back
 * to the cookie, and `sameSiteWrites` still judges any request that carries the cookie.
 * `write-protection.test.ts` fails when a page write is neither under `CSRF_PATHS` nor listed in
 * `ORIGIN_ONLY_WRITES`, and when any cookie-carrying write is accepted cross-site.
 */
import type { MiddlewareHandler } from "hono";
import { csrf } from "../middleware/csrf.ts";

/** Page (form) write paths guarded by CSRF tokens, as Hono `use` patterns. */
export const CSRF_PATHS: readonly string[] = [
  "/auth/logout",
  "/auth/invites/*",
  "/projects/new",
  "/projects/:slug/delete",
  "/projects/:slug/settings/*",
  "/projects/:slug/get-started/*",
  "/profile/*",
  "/connections/*",
  "/profile",
  "/admin/credentials/*",
  "/admin/public-origin",
  "/admin/public-origin/*",
  "/projects/:slug/builds/:buildId/insights/generate",
  "/projects/:slug/builds/:buildId/comments",
  "/projects/:slug/builds/:buildId/comments/*",
  "/projects/:slug/builds/:buildId/mention-suggest",
  "/projects/:slug/builds/:buildId/mention-complete",
  "/projects/:slug/builds/:buildId/reviews",
  "/projects/:slug/insights/health/generate",
];

/**
 * Page writes outside `/api/` that rely on the same-origin rule alone, keyed like the route table,
 * each with the reason a token adds nothing. Keep this list short.
 */
export const ORIGIN_ONLY_WRITES: Readonly<Record<string, string>> = {
  "POST /auth/engine/login":
    "No session exists yet, so a token would be the anonymous one anyone can mint; login CSRF is closed by sameSiteWrites (SIGN_IN_PATHS).",
};

/** Methods that change state. */
export const WRITE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Mount the CSRF token check on every path of `CSRF_PATHS`. */
export function mountCsrf(
  app: { use: (path: string, handler: MiddlewareHandler) => unknown },
  secret: string | undefined,
): void {
  const check = csrf(secret);
  for (const path of CSRF_PATHS) {
    app.use(path, check);
  }
}
