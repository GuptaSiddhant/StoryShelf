import type { OpenAPIHono } from "@hono/zod-openapi";

import { BaselineModel } from "../models/baseline.ts";
import { BuildModel } from "../models/build.ts";
import { SnapshotModel } from "../models/snapshot.ts";
import { getStore } from "../store.ts";
import type { Snapshot } from "../schema.ts";
import type { ProjectRole } from "../types.ts";
import { notFound, resolveAuthorizedProject } from "./helpers.ts";

const VIEW_ROLES: readonly ProjectRole[] = ["viewer", "developer", "approver", "admin"];

const PNG = "image/png";

function imageResponse(buffer: Buffer): Response {
  return new Response(new Uint8Array(buffer), { headers: { "content-type": PNG, "cache-control": "private, max-age=3600" } });
}

export function registerMedia(app: OpenAPIHono): void {
  app.get("/api/v1/projects/:slug/builds/:buildId/snapshots/:snapshotId/image", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...VIEW_ROLES);
    const snapshot = await findSnapshot(c.req.param("buildId"), c.req.param("snapshotId"), project.id);
    return imageResponse(await getStore().storage.read(snapshot.screenshotPath));
  });

  app.get("/api/v1/projects/:slug/builds/:buildId/snapshots/:snapshotId/diff", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...VIEW_ROLES);
    const snapshot = await findSnapshot(c.req.param("buildId"), c.req.param("snapshotId"), project.id);
    if (!snapshot.diffPath) {
      notFound("No diff for this snapshot");
    }
    return imageResponse(await getStore().storage.read(snapshot.diffPath));
  });

  app.get("/api/v1/projects/:slug/builds/:buildId/snapshots/:snapshotId/baseline", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...VIEW_ROLES);
    const snapshot = await findSnapshot(c.req.param("buildId"), c.req.param("snapshotId"), project.id);
    const build = await new BuildModel(getStore().db).get(snapshot.buildId);
    if (!build) {
      notFound("Build not found");
    }
    const baselines = new BaselineModel(getStore().db, getStore().storage);
    const baseline = await baselines.resolve(project.id, snapshot.storyId, snapshot.viewportName, build.gitBranch, project.gitDefaultBranch);
    if (!baseline) {
      notFound("No baseline for this snapshot");
    }
    return imageResponse(await baselines.read(baseline));
  });
}

async function findSnapshot(buildId: string, snapshotId: string, projectId: string): Promise<Snapshot> {
  const snapshot = await new SnapshotModel(getStore().db).get(snapshotId);
  if (!snapshot || snapshot.buildId !== buildId || snapshot.projectId !== projectId) {
    notFound("Snapshot not found");
  }
  return snapshot;
}