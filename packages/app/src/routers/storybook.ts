import type { ShelfRouter } from "../app-types.ts";
import {
  redirectToLabelBuild,
  redirectToLatestBuild,
  serveBuildStorybook,
  serveShortLink,
} from "./storybook.handlers.ts";

/** Register the published Storybook resolver and static-asset routes. */
export function registerStorybook(app: ShelfRouter): void {
  app.get("/_", (c) => c.redirect("/", 302));
  app.get("/_/", (c) => c.redirect("/", 302));

  app.get("/projects/:slug/storybook", async (c) => await redirectToLatestBuild(c));

  // Short link canonical is /_/:id/ with trailing slash (so relative ./sb-manager/... resolves).
  app.get("/_/:id", (c) => {
    // Always redirect, whether or not the id exists: the checks (and the 404) belong to the
    // trailing-slash route, so a caller without a role cannot tell a project from a missing one (#497).
    return c.redirect(`/_/${encodeURIComponent(c.req.param("id"))}/`, 302);
  });
  app.get("/_/:id/*", async (c) => await serveShortLink(c));

  app.get("/projects/:slug/storybook/build/:buildId/*", async (c) => await serveBuildStorybook(c));
  app.get("/projects/:slug/storybook/:key/*", async (c) => await redirectToLabelBuild(c));
}
