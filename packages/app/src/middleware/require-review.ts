import type { Context, Next } from "hono";
import { resolveAuthorizedProject } from "../routers/helpers.ts";
import { matchedRouteClass } from "./require-testing.ts";

/** Body of the 404 a `review` route answers for a project with review off. */
export const REVIEW_DISABLED_MESSAGE = "Review is off for this project.";

/** Roles that may see a project's routes at all; the gate answers only to them. */
const VIEWER_ROLES = ["viewer", "developer", "approver", "admin"] as const;

/** The project slug of `/api/v1/projects/:slug/...` and `/projects/:slug/...` paths. */
function projectSlugOf(path: string): string | undefined {
  return /^(?:\/api\/v1)?\/projects\/(?<slug>[^/]+)\//u.exec(path)?.groups?.["slug"];
}

/**
 * Gate routes classified `review` (ADR 0013, decision 10): they answer 404 for a project that has
 * review off, as if they did not exist. The switch is read from the database on every request, so
 * turning review off or on takes effect at once. Only a caller who may view the project is told
 * (anyone else gets the route's own refusal), so the gate reveals nothing about a project the
 * caller cannot see. It runs after the store scope and the auth gate, which it needs to resolve
 * the caller; routes of other classes, and unknown projects, pass through.
 */
export function requireReview() {
  // oxlint-disable-next-line typescript/no-invalid-void-type -- Hono middleware may not return Response
  return async (c: Context, next: Next): Promise<Response | void> => {
    if (matchedRouteClass(c) !== "review" || !(await reviewIsOff(c))) {
      await next();
      return;
    }
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: REVIEW_DISABLED_MESSAGE }, 404);
    }
    return c.text(REVIEW_DISABLED_MESSAGE, 404);
  };
}

/** Whether the request names a project the caller may view and whose review switch is off. */
async function reviewIsOff(c: Context): Promise<boolean> {
  const slug = projectSlugOf(c.req.path);
  if (slug === undefined) {
    return false;
  }
  try {
    const project = await resolveAuthorizedProject(c, slug, ...VIEWER_ROLES);
    return project.reviewEnabled === false;
  } catch {
    return false;
  }
}
