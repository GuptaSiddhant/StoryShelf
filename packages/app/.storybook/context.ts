import type { Context } from "hono";

/**
 * A request context for page data loaders that take one but only read the (absent) viewer and
 * query from it. Story-only: production routes always get the real Hono context.
 */
export const storyContext = {
  req: {
    url: "http://storybook.local/",
    header: () => null,
    query: () => null,
    param: () => null,
  },
  get: () => null,
  var: {},
} as unknown as Context;
