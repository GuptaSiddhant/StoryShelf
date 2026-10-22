/**
 * Route classification (ADR 0006, decision 8): every route the app registers declares whether it
 * belongs to hosting, testing, review, or both. `classification.test.ts` fails on any registered
 * route missing here and on any entry that no longer matches a route, so a new route must be
 * classified in `api-routes.ts` or `page-routes.ts` in the same change.
 *
 * Today the table only describes the routes; nothing is gated by it yet (gating comes with the
 * `testing` option work, which will apply it as middleware).
 */
import { API_ROUTE_CLASSES } from "./api-routes.ts";
import { PAGE_ROUTE_CLASSES } from "./page-routes.ts";

/**
 * - `hosting`: available with and without `testing`.
 * - `testing`: 404 without `testing`.
 * - `review`: 404 when the project's review switch is off.
 * - `both`: present in both modes, with sections gated by `testing`.
 */
export type RouteClass = "hosting" | "testing" | "review" | "both";

export const ROUTE_CLASS_VALUES: readonly RouteClass[] = ["hosting", "testing", "review", "both"];

/** The full table, keyed by `"METHOD /hono-pattern"` exactly as `app.routes` reports it. */
export const ROUTE_CLASSES: Readonly<Record<string, RouteClass>> = {
  ...API_ROUTE_CLASSES,
  ...PAGE_ROUTE_CLASSES,
};

/**
 * Route families whose individual patterns are not worth listing (content-hashed static assets).
 * A rule applies to any method whose path starts with `prefix`.
 */
export const ROUTE_PREFIX_CLASSES: readonly { prefix: string; routeClass: RouteClass }[] = [
  { prefix: "/assets/", routeClass: "hosting" },
];

/** The class of a registered route, or `undefined` when it is unclassified. */
export function classOfRoute(method: string, path: string): RouteClass | undefined {
  const exact = ROUTE_CLASSES[`${method} ${path}`];
  if (exact !== undefined) {
    return exact;
  }
  return ROUTE_PREFIX_CLASSES.find((rule) => path.startsWith(rule.prefix))?.routeClass;
}
