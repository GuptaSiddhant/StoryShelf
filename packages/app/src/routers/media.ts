import { BaselineModel, DesignModel, FigmaNodeModel } from "@storyshelf/core/models";
import { BuildModel } from "@storyshelf/core/models";
import { SnapshotModel } from "@storyshelf/core/models";
import type { Snapshot } from "@storyshelf/core/schema";
import type { ProjectRole } from "@storyshelf/core/types";
import type { ShelfRouter } from "../app-types.ts";
import { credentialKeys } from "../credential-keys.ts";
import { getStore } from "../store.ts";
import { notFound, resolveAuthorizedProject } from "./helpers.ts";
const VIEW_ROLES: readonly ProjectRole[] = ["viewer", "developer", "approver", "admin"];

const PNG = "image/png";

function imageResponse(buffer: Buffer, cacheControl = "private, max-age=3600"): Response {
  return new Response(new Uint8Array(buffer), {
    headers: { "content-type": PNG, "cache-control": cacheControl },
  });
}

/** Design renders are addressed by file version (`?v=`): immutable once the version matches the row. */
const RENDER_IMMUTABLE = "private, max-age=31536000, immutable";

/** Register the PNG image, diff, and baseline media endpoints for snapshots. */
export function registerMedia(app: ShelfRouter): void {
  app.get("/api/v1/projects/:slug/builds/:buildId/snapshots/:snapshotId/image", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...VIEW_ROLES);
    const snapshot = await findSnapshot(
      c.req.param("buildId"),
      c.req.param("snapshotId"),
      project.id,
    );
    return imageResponse(await getStore().storage.read(snapshot.screenshotPath));
  });

  app.get("/api/v1/projects/:slug/builds/:buildId/snapshots/:snapshotId/diff", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...VIEW_ROLES);
    const snapshot = await findSnapshot(
      c.req.param("buildId"),
      c.req.param("snapshotId"),
      project.id,
    );
    if (!snapshot.diffPath) {
      notFound("No diff for this snapshot");
    }
    return imageResponse(await getStore().storage.read(snapshot.diffPath));
  });

  // `:renderId` is the internal figma_nodes row id (a ULID), not a Figma node id.
  app.get("/api/v1/projects/:slug/design/renders/:renderId", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...VIEW_ROLES);
    const { db, config, storage } = getStore();
    const design = new DesignModel(db, undefined, credentialKeys(config));
    const nodes = new FigmaNodeModel(db, design, { storage });
    const node = await nodes.get(project.id, c.req.param("renderId"));
    const png = node ? await nodes.readRender(node) : null;
    if (!png) {
      notFound("No design render");
    }
    const versioned = node?.renderVersion && c.req.query("v") === node.renderVersion;
    return imageResponse(png, versioned ? RENDER_IMMUTABLE : undefined);
  });

  app.get("/api/v1/projects/:slug/builds/:buildId/snapshots/:snapshotId/baseline", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...VIEW_ROLES);
    const snapshot = await findSnapshot(
      c.req.param("buildId"),
      c.req.param("snapshotId"),
      project.id,
    );
    const build = await new BuildModel(getStore().db).get(snapshot.buildId);
    if (!build) {
      notFound("Build not found");
    }
    const baselines = new BaselineModel(getStore().db, undefined, getStore().storage);
    const baseline = await baselines.resolve(
      project.id,
      snapshot.storyId,
      snapshot.viewportName,
      build.gitBranch,
      project.gitDefaultBranch,
      snapshot.browser,
    );
    if (!baseline) {
      notFound("No baseline for this snapshot");
    }
    return imageResponse(await baselines.read(baseline));
  });
}

async function findSnapshot(
  buildId: string,
  snapshotId: string,
  projectId: string,
): Promise<Snapshot> {
  const snapshot = await new SnapshotModel(getStore().db).get(snapshotId);
  if (!snapshot || snapshot.buildId !== buildId || snapshot.projectId !== projectId) {
    notFound("Snapshot not found");
  }
  return snapshot;
}
