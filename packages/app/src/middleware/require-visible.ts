import type { Context, Next } from "hono";
import { currentProjectRole, findProjectBySlug, requestHasAdminToken } from "../routers/helpers.ts";
import { getStore } from "../store.ts";

/** The slug of a server-rendered `/projects/:slug/...` page path (not the API, not Storybook). */
function pageProjectSlug(path: string): string | undefined {
  const slug = /^\/projects\/(?<slug>[^/]+)\/(?<rest>.+)$/u.exec(path)?.groups;
  if (!slug?.["slug"] || slug["slug"] === "new") {
    return undefined;
  }
  // Published Storybook routes enforce their own access (public builds, ADR 0011).
  return slug["rest"]?.startsWith("storybook") === true ? undefined : slug["slug"];
}

/**
 * Pages of a project answer only to a caller with a role on it. Anyone else gets the standard 404,
 * the same page as for a slug that does not exist, so a signed-in user cannot tell which projects
 * exist (`403` stays for a caller who can see the project but lacks the role for the action, and is
 * decided where the action is). The API does this in `assertRole`; this covers the pages, which
 * would otherwise render for any signed-in user. It runs after the auth gate, which redirects
 * visitors who are not signed in, and does nothing when auth is off or for the bootstrap admin token.
 */
export function requireProjectVisible() {
  // oxlint-disable-next-line typescript/no-invalid-void-type -- Hono middleware may not return Response
  return async (c: Context, next: Next): Promise<Response | void> => {
    const slug = pageProjectSlug(c.req.path);
    if (slug === undefined || !getStore().authEnabled || requestHasAdminToken(c)) {
      await next();
      return;
    }
    const project = await findProjectBySlug(slug);
    if (project && (await currentProjectRole(project.id))) {
      await next();
      return;
    }
    return c.notFound();
  };
}
