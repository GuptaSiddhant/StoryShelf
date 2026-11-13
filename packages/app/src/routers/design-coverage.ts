import { BuildModel, SnapshotModel } from "@storyshelf/core/models";
import type { BuildSummary } from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { renderDesignCoveragePage, type DesignCoverageData } from "../pages/design-coverage.tsx";
import { entriesFromSnapshots } from "../pages/library-model.ts";
import { catalogOf, getStore, testingEnabled } from "../store.ts";
import { coverageOf } from "./design-coverage.handlers.ts";
import { currentProjectRole, findProjectBySlug, requestHasAdminToken } from "./helpers.ts";

/** The page's data before any build was accepted: nothing to read. */
const NO_COVERAGE: Omit<DesignCoverageData, "project"> = {
  build: null,
  unlinked: [],
  drifted: [],
  current: 0,
  unknown: 0,
  withoutToken: [],
  lastChecked: null,
  storyLinksRead: false,
};

/** The design coverage page (class `hosting`): needs a configured design provider, and a member. */
export function registerDesignCoverage(app: ShelfRouter): void {
  app.get("/projects/:slug/design/coverage", async (c) => {
    const data = await loadDesignCoverage(c, c.req.param("slug"));
    return data ? c.html(renderDesignCoveragePage(data)) : c.notFound();
  });
}

/**
 * The page's data, or null (a 404) when no design provider is configured, the project is
 * unknown, or the viewer is not a member of it. Reads only what was stored: the catalog of the
 * latest accepted build, the design links, and cached design nodes. It never calls a provider.
 */
export async function loadDesignCoverage(
  c: Context,
  slug: string,
): Promise<DesignCoverageData | null> {
  if (getStore().design.length === 0) return null;
  const project = await findProjectBySlug(slug);
  if (!project || !(await mayView(c, project))) return null;
  const build = await latestAcceptedBuild(project);
  if (!build) return { ...NO_COVERAGE, project };
  const snapshots = testingEnabled()
    ? await new SnapshotModel(getStore().db).listByBuildSummary(build.id)
    : [];
  const catalog = await catalogOf().load(project.id, build.id);
  const entries = catalog?.entries ?? entriesFromSnapshots(snapshots);
  return await coverageOf(project, build, entries, snapshots);
}

/** With auth on, only a member (any role) or the bootstrap admin token sees the page. */
async function mayView(c: Context, project: Project): Promise<boolean> {
  if (!getStore().authEnabled || requestHasAdminToken(c)) return true;
  return (await currentProjectRole(project.id)) !== null;
}

/** Newest approved build on the default branch, else the newest approved on any branch. */
async function latestAcceptedBuild(project: Project): Promise<BuildSummary | undefined> {
  const builds = new BuildModel(getStore().db);
  const approved = { status: "approved", limit: 1 } as const;
  const [onDefault] = await builds.listSummary(project.id, {
    ...approved,
    branch: project.gitDefaultBranch,
  });
  return onDefault ?? (await builds.listSummary(project.id, approved))[0];
}
