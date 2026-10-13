/**
 * Baseline portability endpoints: export a project's baselines as a zip
 * (`manifest.json` + PNGs, format v1) and import (upsert) the same format.
 * Format, limits, and validation live in `@storyshelf/core/models`
 * (`BaselineTransferModel`); this router owns HTTP concerns only.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { BaselineArchiveError, BaselineTransferModel } from "@storyshelf/core/models";
import type { ProjectRole } from "@storyshelf/core/types";
import { HTTPException } from "hono/http-exception";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import {
  archiveFileName,
  importByteLimit,
  readCappedBody,
  toWebStream,
} from "./baselines.handlers.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { badRequest, errorSchema, forbidden, notFound, unauthorized } from "./schemas.ts";

const VIEW_ROLES: readonly ProjectRole[] = ["viewer", "developer", "approver", "admin"];
const APPROVER_ROLES: readonly ProjectRole[] = ["approver", "admin"];

const zipSchema = z.string().openapi({ type: "string", format: "binary" });
const importResultSchema = z
  .object({
    imported: z.number().int().openapi({ description: "Baselines in the archive (all applied)" }),
    created: z.number().int().openapi({ description: "Baselines that did not exist before" }),
    updated: z.number().int().openapi({ description: "Existing baselines overwritten" }),
  })
  .openapi("BaselineImportResult");

const exportRoute = createRoute({
  method: "get",
  tags: ["Baselines"],
  summary: "Export baselines as a zip archive",
  description:
    "Streams `manifest.json` (story/mode/browser/branch → file, SHA-256, timestamps) plus one PNG per baseline at `baselines/<branch>/<storyId>/<mode>.png`. Baselines whose image cannot be read are listed under `skipped`.",
  path: "/api/v1/projects/{slug}/baselines/export",
  request: {
    params: z.object({ slug: z.string() }),
    query: z.object({
      branch: z.string().min(1).optional().openapi({ description: "Export only this branch" }),
    }),
  },
  responses: {
    200: { content: { "application/zip": { schema: zipSchema } }, description: "Baseline archive" },
    ...badRequest,
    ...unauthorized,
    ...forbidden,
    ...notFound,
  },
});

const importRoute = createRoute({
  method: "post",
  tags: ["Baselines"],
  summary: "Import (upsert) baselines from a zip archive",
  description:
    "Accepts an archive produced by the export endpoint. The whole archive is validated (manifest schema, path safety, PNG signature, SHA-256) before anything is written; baselines with the same story/mode/browser/branch are overwritten. Requires the approver role.",
  path: "/api/v1/projects/{slug}/baselines/import",
  request: {
    params: z.object({ slug: z.string() }),
    body: { content: { "application/zip": { schema: zipSchema } }, required: true },
  },
  responses: {
    200: {
      content: { "application/json": { schema: importResultSchema } },
      description: "Baselines imported",
    },
    413: {
      content: { "application/json": { schema: errorSchema } },
      description: "Archive exceeds the size limit",
    },
    ...badRequest,
    ...unauthorized,
    ...forbidden,
    ...notFound,
  },
});

/** Map archive validation failures to 400s; rethrow everything else. */
function asBadRequest(error: unknown): never {
  if (error instanceof BaselineArchiveError) {
    throw new HTTPException(400, { message: error.message });
  }
  throw error;
}

/** Register the baseline export/import endpoints. */
export function registerBaselines(app: ShelfRouter): void {
  app.openapi(exportRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...VIEW_ROLES);
    const { branch } = c.req.valid("query");
    const { db, storage } = getStore();
    const chunks = await new BaselineTransferModel(db, storage)
      .export(project.id, { branch, project: project.slug })
      .catch(asBadRequest);
    return new Response(toWebStream(chunks), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${archiveFileName(project.slug, branch)}"`,
        "cache-control": "no-store",
      },
    });
  });

  app.openapi(importRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...APPROVER_ROLES);
    const archive = await readCappedBody(c.req.raw, importByteLimit(getStore().config));
    const { db, storage } = getStore();
    const result = await new BaselineTransferModel(db, storage)
      .import(project.id, archive)
      .catch(asBadRequest);
    getStore().logger.info({ projectId: project.id, ...result }, "baselines imported");
    return c.json(result, 200);
  });
}
