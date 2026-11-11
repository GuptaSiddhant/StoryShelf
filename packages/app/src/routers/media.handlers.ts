/** Handlers of the snapshot and design image endpoints (composed by `media.ts`). */
import {
  BaselineModel,
  DesignCredentialModel,
  DesignNodeModel,
  baselineStatus,
  BuildModel,
  SnapshotModel,
} from "@storyshelf/core/models";
import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import type { ProjectRole } from "@storyshelf/core/types";
import type { Context } from "hono";
import { credentialKeys } from "../credential-keys.ts";
import { getStore } from "../store.ts";
import { readComparisonImage, validFrozenReference } from "./comparison-image.ts";
import { notFound, resolveAuthorizedProject } from "./helpers.ts";

const VIEW_ROLES: readonly ProjectRole[] = ["viewer", "developer", "approver", "admin"];

const PNG = "image/png";

/** A render fetched with a member's own connection: the browser must not keep it past the session. */
const RENDER_MEMBER = "private, no-store";

/** Design renders are addressed by file version (`?v=`): immutable once the version matches the row. */
const RENDER_IMMUTABLE = "private, max-age=31536000, immutable";

const NO_STORE = "private, no-store";

function imageResponse(buffer: Buffer, cacheControl = "private, max-age=3600"): Response {
  return new Response(new Uint8Array(buffer), {
    headers: { "content-type": PNG, "cache-control": cacheControl },
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

/** Authorize the caller on the project of the route and load the snapshot it names. */
async function authorizedSnapshot(c: Context): Promise<{ project: Project; snapshot: Snapshot }> {
  const project = await resolveAuthorizedProject(c, c.req.param("slug") ?? "", ...VIEW_ROLES);
  const snapshot = await findSnapshot(
    c.req.param("buildId") ?? "",
    c.req.param("snapshotId") ?? "",
    project.id,
  );
  return { project, snapshot };
}

/** The snapshot's screenshot. */
export async function serveSnapshotImage(c: Context): Promise<Response> {
  const { snapshot } = await authorizedSnapshot(c);
  return imageResponse(await getStore().storage.read(snapshot.screenshotPath));
}

/** The snapshot's diff image; 404 when it has none. */
export async function serveSnapshotDiff(c: Context): Promise<Response> {
  const { snapshot } = await authorizedSnapshot(c);
  if (!snapshot.diffPath) {
    notFound("No diff for this snapshot");
  }
  return imageResponse(await getStore().storage.read(snapshot.diffPath));
}

function designNodes(): DesignNodeModel {
  const { db, config, storage, design } = getStore();
  const credentials = new DesignCredentialModel(db, credentialKeys(config));
  return new DesignNodeModel(db, credentials, design, { storage });
}

/** A design render; `:renderId` is the internal design_nodes row id (a ULID), not a provider node id. */
export async function serveDesignRender(c: Context): Promise<Response> {
  const project = await resolveAuthorizedProject(c, c.req.param("slug") ?? "", ...VIEW_ROLES);
  const nodes = designNodes();
  const found = await nodes.get(project.id, c.req.param("renderId") ?? "");
  // A render fetched with a member's own connection is theirs alone (it may show files others cannot open).
  const node =
    found && (found.viewerId === "" || found.viewerId === getStore().user?.id) ? found : null;
  const png = node ? await nodes.readRender(node) : null;
  if (!png) {
    notFound("No design render");
  }
  const versioned = node?.renderVersion && c.req.query("v") === node.renderVersion;
  const cacheControl = node?.viewerId ? RENDER_MEMBER : versioned ? RENDER_IMMUTABLE : undefined;
  return imageResponse(png, cacheControl);
}

/** The baseline a snapshot was compared against, frozen at diff time, or the live one. */
export async function serveBaseline(c: Context): Promise<Response> {
  const { project, snapshot } = await authorizedSnapshot(c);
  const build = await new BuildModel(getStore().db).get(snapshot.buildId);
  if (!build) {
    notFound("Build not found");
  }
  const isDefault = c.req.query("reference") === "default";
  if (!isDefault && (snapshot.comparisonImagePath || snapshot.comparisonMetadata)) {
    return await frozenReference(snapshot, project, build);
  }
  const baselines = new BaselineModel(getStore().db, undefined, getStore().storage);
  const baseline = isDefault
    ? await defaultBaseline(c, baselines, project, snapshot)
    : await currentBaseline(baselines, project, snapshot, build);
  return imageResponse(await baselines.read(baseline), NO_STORE);
}

async function frozenReference(
  snapshot: Snapshot,
  project: Project,
  build: Build,
): Promise<Response> {
  const frozen = validFrozenReference(snapshot, project.id, build.id);
  if (!frozen) {
    notFound("Original baseline is unavailable");
  }
  const image = await readComparisonImage(frozen.path, frozen.reference.imageSha256);
  if (!image) {
    notFound("Original baseline image is unavailable");
  }
  return imageResponse(image, NO_STORE);
}

type Baseline = NonNullable<Awaited<ReturnType<BaselineModel["getFor"]>>>;

/** The default branch's baseline, which must still be the one (`id`, `version`) the page showed. */
async function defaultBaseline(
  c: Context,
  baselines: BaselineModel,
  project: Project,
  snapshot: Snapshot,
): Promise<Baseline> {
  const baseline = await baselines.getFor(
    project.id,
    snapshot.storyId,
    snapshot.viewportName,
    project.gitDefaultBranch,
    snapshot.browser,
  );
  if (baseline?.id !== c.req.query("id") || baseline?.updatedAt !== c.req.query("version")) {
    notFound("Default baseline changed; reload the comparison");
  }
  if (!baseline) {
    notFound("No baseline for this snapshot");
  }
  return baseline;
}

/** The baseline the build's branch resolves to, which must still match the snapshot's version. */
async function currentBaseline(
  baselines: BaselineModel,
  project: Project,
  snapshot: Snapshot,
  build: Build,
): Promise<Baseline> {
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
  if (snapshot.baselineVersion !== null && baselineStatus(snapshot, baseline) !== "current") {
    notFound("Original baseline is no longer available");
  }
  return baseline;
}
