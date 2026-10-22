import type { Context, Next } from "hono";
import { matchedRoutes } from "hono/route";
import { classOfRoute } from "../routes/classification.ts";

/** Body of the 404 a `testing` route answers on a hosting-only instance. */
export const TESTING_DISABLED_MESSAGE = "Testing is not enabled on this instance.";

/**
 * Gate routes classified `testing` (ADR 0006, decisions 1 and 8): without `options.testing` they
 * answer 404, as if the feature did not exist. The class comes from the route table through the
 * handler Hono matched, so a new route needs no guard of its own, only a table entry. It is mounted
 * before the CSRF and rate-limit guards so a hidden route answers the same 404 for every request. `hosting`,
 * `both` and `review` routes, and requests that match no classified route, pass through.
 */
export function requireTesting(enabled: boolean) {
  // oxlint-disable-next-line typescript/no-invalid-void-type -- Hono middleware may not return Response
  return async (c: Context, next: Next): Promise<Response | void> => {
    if (enabled || !isTestingRoute(c)) {
      await next();
      return;
    }
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: TESTING_DISABLED_MESSAGE }, 404);
    }
    return c.text(TESTING_DISABLED_MESSAGE, 404);
  };
}

/** The last matched handler that the table classifies (middleware matches come first). */
function isTestingRoute(c: Context): boolean {
  const routes = matchedRoutes(c);
  for (let index = routes.length - 1; index >= 0; index -= 1) {
    const route = routes[index];
    const routeClass = route && classOfRoute(route.method, route.path);
    if (routeClass !== undefined) {
      return routeClass === "testing";
    }
  }
  return false;
}
