/** Tags every operation of an OpenAPI document with the class of its route (`x-storyshelf-class`). */
import { classOfRoute } from "./classification.ts";

interface OpenApiLike {
  paths?: object | undefined;
}

/** OpenAPI path templates (`{slug}`) as Hono patterns (`:slug`), the form the route table uses. */
function honoPattern(path: string): string {
  return path.replaceAll(/\{(?<name>[^}]+)\}/gu, ":$<name>");
}

/** `document` with `x-storyshelf-class` on each operation whose route the table classifies. */
export function markRouteClasses<T extends OpenApiLike>(document: T): T {
  for (const [path, operations] of Object.entries(document.paths ?? {}) as [string, object][]) {
    for (const [method, operation] of Object.entries(operations)) {
      const routeClass = classOfRoute(method.toUpperCase(), honoPattern(path));
      if (routeClass !== undefined && typeof operation === "object" && operation !== null) {
        (operation as Record<string, unknown>)["x-storyshelf-class"] = routeClass;
      }
    }
  }
  return document;
}
