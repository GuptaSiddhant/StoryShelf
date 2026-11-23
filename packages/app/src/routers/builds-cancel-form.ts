import { contentHostSuffix } from "@storyshelf/core/config";
import { createUrlBuilder } from "@storyshelf/core/urls";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { cancelOlderBuilds } from "./builds-cancel-bulk.ts";
import { DEVELOPER_ROLES } from "./builds.handlers.ts";
import { flash } from "./flash.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { hxRefresh, isHxRequest } from "./htmx.ts";

/**
 * Register the builds page's "Cancel older unfinished builds" form (`POST /projects/:slug/builds/cancel`,
 * `testing` class, CSRF token). A browser form cannot post JSON to `/api/v1`, so this page route
 * reads nothing from the form and calls the same {@link cancelOlderBuilds} as the API route.
 */
export function registerBuildsCancelForm(app: ShelfRouter): void {
  app.post("/projects/:slug/builds/cancel", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...DEVELOPER_ROLES);
    const cancelled = await cancelOlderBuilds(project.id);
    flash(c, `${cancelled.length} ${cancelled.length === 1 ? "build" : "builds"} cancelled`);
    if (isHxRequest(c)) {
      hxRefresh(c);
      return c.body(null, 204);
    }
    const urls = createUrlBuilder("/", contentHostSuffix(getStore().config));
    return c.redirect(urls.buildsList(project.slug), 303);
  });
}
