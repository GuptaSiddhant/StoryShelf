/**
 * `GET /api/v1/projects/:slug/builds/:buildId/preview-token`: a fresh root for a component page's preview frame
 * (ADR 0006, decision 9). A frame holding a signed `/_s/<token>` URL (ADR 0007, decision 5) outlives
 * the token's hour on a page left open, so the page's script asks for a new root before then and
 * re-points the frame. Answers `{ base }` for a viewer who may open the build, 404 otherwise or when
 * the build needs no token (anyone may open it). Never cached: the answer carries a token.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { BuildModel, ProjectModel } from "@storyshelf/core/models";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { isSignedPreviewBase, previewBaseOf } from "./preview-base.ts";
import { SIGNED_URL_HEADERS } from "./published-files.ts";

const previewTokenRoute = createRoute({
  method: "get",
  tags: ["Review"],
  summary: "Get a fresh signed root for a build's preview frame",
  path: "/api/v1/projects/{slug}/builds/{buildId}/preview-token",
  request: { params: z.object({ slug: z.string(), buildId: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ base: z.string() }) } },
      description: "The signed root (`/_s/<token>`) to frame the build's Storybook under",
    },
    404: {
      content: { "text/plain": { schema: z.string() } },
      description: "Not found, or the build needs no signed URL",
    },
  },
});

/** Register the preview token refresh route. */
export function registerPreviewToken(app: ShelfRouter): void {
  app.openapi(previewTokenRoute, async (c) => {
    const { db } = getStore();
    const project = await new ProjectModel(db).getBySlug(c.req.param("slug"));
    const build = await new BuildModel(db).get(c.req.param("buildId"));
    const base =
      project && build?.projectId === project.id ? await previewBaseOf(project, build) : null;
    if (base === null || !isSignedPreviewBase(base)) {
      return c.text("Not found", 404, SIGNED_URL_HEADERS);
    }
    return c.json({ base }, 200, SIGNED_URL_HEADERS);
  });
}
