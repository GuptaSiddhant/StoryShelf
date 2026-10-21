/** Lists the routes a booted app registers, as `{ method, path }` pairs without middleware. */
import type { OpenAPIHono } from "@hono/zod-openapi";
import { ROUTE_CLASSES } from "./classification.ts";

export interface RegisteredRoute {
  method: string;
  path: string;
}

/**
 * Unique `{ method, path }` pairs of `app.routes`. Hono reports middleware (`app.use`) as method
 * `ALL`, so `ALL` entries are skipped unless the table lists them explicitly (the auth engine
 * mounts a real `app.all` handler). A new `app.all(...)` handler must therefore be added to the
 * table to be checked.
 */
export function listRegisteredRoutes(app: Pick<OpenAPIHono, "routes">): RegisteredRoute[] {
  const seen = new Set<string>();
  const routes: RegisteredRoute[] = [];
  for (const { method, path } of app.routes) {
    const key = `${method} ${path}`;
    if (seen.has(key) || (method === "ALL" && !(key in ROUTE_CLASSES))) {
      continue;
    }
    seen.add(key);
    routes.push({ method, path });
  }
  return routes;
}
