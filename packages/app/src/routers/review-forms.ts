/**
 * The review forms of the build, diff and component pages. HTMX and plain forms post
 * `application/x-www-form-urlencoded`, which the JSON endpoints under `/api/v1` refuse (415), so
 * each form has a page route that reads the form and calls the same handlers as the API. All
 * three are `review` routes: they answer 404 for a project with review off.
 */
import type { Build, Project } from "@storyshelf/core/schema";
import type { ProjectRole } from "@storyshelf/core/types";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ShelfRouter } from "../app-types.ts";
import { giveVerdict } from "./build-reviews.handlers.ts";
import { APPROVER_ROLES, DEVELOPER_ROLES, buildForProject } from "./builds.handlers.ts";
import { createComment, resolveBuildComment } from "./comments.ts";
import { flash } from "./flash.ts";
import { resolveAuthorizedProject, resolveReviewer } from "./helpers.ts";
import { hxRefresh } from "./htmx.ts";
import { buildReviewCreateSchema, commentCreateSchema } from "./schemas.ts";

/** Register the form routes of review (`review` class). */
export function registerReviewForms(app: ShelfRouter): void {
  const base = "/projects/:slug/builds/:buildId";
  app.post(`${base}/comments`, async (c) => {
    const { project, build } = await target(c, DEVELOPER_ROLES);
    const input = commentCreateSchema.safeParse(await fields(c));
    if (!input.success) {
      throw new HTTPException(400, {
        message: "A comment needs some text (up to 4000 characters)",
      });
    }
    await createComment(project, build.id, input.data);
    return done(c, build.id, "Comment added");
  });

  app.post(`${base}/comments/:commentId/resolve`, async (c) => {
    const { build } = await target(c, DEVELOPER_ROLES);
    await resolveBuildComment(build.id, c.req.param("commentId"));
    return done(c, build.id, "Comment resolved");
  });

  app.post(`${base}/reviews`, async (c) => {
    const { project, build } = await target(c, APPROVER_ROLES);
    const input = buildReviewCreateSchema.safeParse(await fields(c));
    if (!input.success) {
      throw new HTTPException(400, { message: "Choose approve or reject" });
    }
    await giveVerdict(project, build, await resolveReviewer(c), input.data);
    return done(c, build.id, "Verdict recorded");
  });
}

async function target(
  c: Context,
  roles: readonly ProjectRole[],
): Promise<{ project: Project; build: Build }> {
  const project = await resolveAuthorizedProject(c, c.req.param("slug") ?? "", ...roles);
  const build = await buildForProject(project.id, c.req.param("buildId") ?? "");
  return { project, build };
}

/** The form's text fields, blanks left out (an empty `storyId` means no story). */
async function fields(c: Context): Promise<Record<string, string>> {
  const form = await c.req.formData();
  const values: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string" && key !== "csrf_token" && value.trim() !== "") {
      values[key] = value.trim();
    }
  }
  return values;
}

/** HTMX reloads the page it posted from; a plain form goes back to the page, else the build. */
function done(c: Context, buildId: string, message: string): Response {
  flash(c, message);
  if (c.req.header("HX-Request") === "true") {
    hxRefresh(c);
    return c.body(null, 204);
  }
  return c.redirect(returnPath(c, buildId), 303);
}

/** The path the form was posted from when it is on this host, else the build page. */
function returnPath(c: Context, buildId: string): string {
  const slug = c.req.param("slug") ?? "";
  const fallback = `/projects/${slug}/builds/${buildId}`;
  try {
    const referer = new URL(c.req.header("referer") ?? "", c.req.url);
    return referer.origin === new URL(c.req.url).origin
      ? `${referer.pathname}${referer.search}`
      : fallback;
  } catch {
    return fallback;
  }
}
