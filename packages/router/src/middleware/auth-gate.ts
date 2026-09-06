import type { Context, Next } from "hono";
import type { AuthAdapter, AuthUser } from "../adapters/auth.ts";
import { getStore } from "../store.ts";

/** Resolve the request user from the auth adapter (null when auth is off or a token is used). */
export async function resolveRequestUser(
  c: Pick<Context, "req">,
  auth?: AuthAdapter,
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
 * Gate the server-rendered UI behind auth (ADR 0008): unauthenticated HTML
 * requests redirect to login. API/auth routes answer 401/403 themselves, and
 * published-Storybook routes enforce their own auth (public builds are
 * viewable without a session, ADR 0011).
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
      (path.startsWith("/projects/") && path.includes("/storybook"))
    ) {
      await next();
      return;
    }
    if (c.req.header("HX-Request") === "true") {
      c.header("HX-Redirect", "/auth/login");
      return c.body(null, 204);
    }
    return c.redirect("/auth/login", 302);
  };
}
