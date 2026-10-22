import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";
import {
  ROUTE_CLASSES,
  ROUTE_CLASS_VALUES,
  ROUTE_PREFIX_CLASSES,
  classOfRoute,
} from "./classification.ts";
import { listRegisteredRoutes } from "./enumerate.ts";

/** Boots with auth set, so the auth-gated routes (engine, profile, connections) register too. */
function bootedRoutes(): ReturnType<typeof listRegisteredRoutes> {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const app = createShelfApp({ database: db, storage, auth: stubAuth(null) });
  return listRegisteredRoutes(app);
}

describe("route classification", () => {
  const routes = bootedRoutes();

  it("enumerates the registered routes", () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.some((route) => route.method === "ALL" && route.path === "*")).toBe(false);
  });

  it("classifies every registered route", () => {
    const unclassified = routes
      .filter((route) => classOfRoute(route.method, route.path) === undefined)
      .map((route) => `${route.method} ${route.path}`);
    expect(
      unclassified,
      "classify new routes in app/src/routes/api-routes.ts or page-routes.ts",
    ).toEqual([]);
  });

  it("has no stale table entries or prefix rules", () => {
    const registered = new Set(routes.map((route) => `${route.method} ${route.path}`));
    const stale = Object.keys(ROUTE_CLASSES).filter((key) => !registered.has(key));
    expect(stale, "remove entries for routes that no longer exist").toEqual([]);
    const idleRules = ROUTE_PREFIX_CLASSES.filter(
      (rule) => !routes.some((route) => route.path.startsWith(rule.prefix)),
    ).map((rule) => rule.prefix);
    expect(idleRules).toEqual([]);
  });

  it("uses only the four known classes", () => {
    for (const routeClass of Object.values(ROUTE_CLASSES)) {
      expect(ROUTE_CLASS_VALUES).toContain(routeClass);
    }
    for (const { routeClass } of ROUTE_PREFIX_CLASSES) {
      expect(ROUTE_CLASS_VALUES).toContain(routeClass);
    }
  });

  it("keeps entries that also match a prefix rule out of the table", () => {
    const shadowed = Object.keys(ROUTE_CLASSES).filter((key) =>
      ROUTE_PREFIX_CLASSES.some((rule) => key.slice(key.indexOf(" ") + 1).startsWith(rule.prefix)),
    );
    expect(shadowed).toEqual([]);
  });

  it("classifies by exact entry first, then by prefix", () => {
    expect(classOfRoute("GET", "/projects/:slug/builds/:buildId/diff")).toBe("testing");
    expect(classOfRoute("PUT", "/api/v1/projects/:slug/builds/:buildId/zip")).toBe("hosting");
    expect(classOfRoute("GET", "/assets/htmx.js")).toBe("hosting");
    expect(classOfRoute("GET", "/not-a-route")).toBeUndefined();
  });
});
