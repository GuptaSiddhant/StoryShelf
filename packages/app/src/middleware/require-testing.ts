import type { Context, Next } from "hono";
import { matchedRoutes } from "hono/route";
import { classOfRoute, type RouteClass } from "../routes/classification.ts";
import { jsonRefusal } from "./api-errors.ts";

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
      return jsonRefusal(c, 404, TESTING_DISABLED_MESSAGE);
    }
    return c.text(TESTING_DISABLED_MESSAGE, 404);
  };
}

/** How many segments of a route pattern are a parameter or a wildcard: fewer is more specific. */
function openSegments(path: string): number {
  return path.split("/").filter((segment) => segment.startsWith(":") || segment.startsWith("*"))
    .length;
}

/**
 * The class of the most specific classified route Hono matched (middleware matches carry no
 * class): the fewest parameter and wildcard segments, the later registration on a tie. A literal
 * route (`/builds/in-flight`) therefore wins over the parameter route (`/builds/:buildId`) that
 * also matches its path.
 */
export function matchedRouteClass(c: Context): RouteClass | undefined {
  let best: { routeClass: RouteClass; open: number } | undefined;
  for (const route of matchedRoutes(c)) {
    const routeClass = classOfRoute(route.method, route.path);
    const open = openSegments(route.path);
    if (routeClass !== undefined && (best === undefined || open <= best.open)) {
      best = { routeClass, open };
    }
  }
  return best?.routeClass;
}

function isTestingRoute(c: Context): boolean {
  return matchedRouteClass(c) === "testing";
}
