import { isPublicBuild, BuildModel } from "@storyshelf/core/models";
import { LabelModel } from "@storyshelf/core/models";
import { ProjectModel } from "@storyshelf/core/models";
import type { Build } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import { isSafeSegment, mimeFor, storybookDir } from "@storyshelf/core/utils";
import { buildLabels, builds, labelTypes, projects, snapshots } from "@storyshelf/db-sqlite/schema";
import { posix } from "node:path";
import type { ShelfApp } from "../index.tsx";
import { renderStorybookPage, renderStorybookPreparingPage } from "../pages/storybook.tsx";
import { getStore } from "../store.ts";
import { currentProjectRole, notFound } from "./helpers.ts";
const VIEW_ROLES: ReadonlySet<string> = new Set(["viewer", "developer", "approver", "admin"]);

function contentTypeFor(path: string): string {
  return mimeFor(path);
}

/**
 * Decide whether the current request may view `build`'s published Storybook.
 *
 * Public builds (ADR 0011) are viewable without auth; every other build requires
 * a logged-in session with at least `viewer` membership on the project.
 */
async function canViewBuild(
  build: Pick<Build, "public" | "gitBranch">,
  project: Project,
): Promise<boolean> {
  if (isPublicBuild(project, build)) {
    return true;
  }
  const { authEnabled } = getStore();
  if (!authEnabled) {
    return true;
  }
  const role = await currentProjectRole(project.id);
  return Boolean(role && VIEW_ROLES.has(role));
}

/** Check whether a build's extracted statics are available for serving. */
async function staticsReady(projectId: string, buildId: string): Promise<boolean> {
  return await getStore().storage.exists(
    posix.join(storybookDir(projectId, buildId), "iframe.html"),
  );
}

/** Register the published Storybook resolver and static-asset routes. */
export function registerStorybook(app: ShelfApp): void {
  // Resolver: latest published build on the default branch.
  app.get("/projects/:slug/storybook", async (c) => {
    const slug = c.req.param("slug");
    const project = await new ProjectModel(getStore().db, { projects }).getBySlug(slug);
    if (!project) {
      notFound("Project not found");
    }
    const build = await new BuildModel(getStore().db, {
      builds,
      buildLabels,
      snapshots,
    }).latestPublished(project);
    if (!build) {
      notFound("No published Storybook for this project");
    }
    if (!(await canViewBuild(build, project))) {
      return c.redirect("/auth/login", 302);
    }
    return c.redirect(`/projects/${slug}/storybook/build/${build.id}/`, 302);
  });

  // Resolver: latest build bearing a label (`build` is a reserved label key).
  app.get("/projects/:slug/storybook/:key/:value", async (c) => {
    const slug = c.req.param("slug");
    const key = c.req.param("key");
    if (key === "build") {
      return c.notFound();
    }
    const value = c.req.param("value");
    const project = await new ProjectModel(getStore().db, { projects }).getBySlug(slug);
    if (!project) {
      notFound("Project not found");
    }
    const buildId = await new LabelModel(getStore().db, {
      builds,
      buildLabels,
      labelTypes,
    }).latestBuildId(project.id, key, value);
    if (!buildId) {
      notFound("No build carries that label");
    }
    const build = await new BuildModel(getStore().db, { builds, buildLabels, snapshots }).get(
      buildId,
    );
    if (!build || !(await canViewBuild(build, project))) {
      return c.redirect("/auth/login", 302);
    }
    return c.redirect(`/projects/${slug}/storybook/build/${buildId}/`, 302);
  });

  // Canonical build route: serves the static Storybook and the landing page.
  app.get("/projects/:slug/storybook/build/:buildId/*", async (c) => {
    const slug = c.req.param("slug");
    const buildId = c.req.param("buildId");
    // Hono's bare `/*` wildcard is not exposed through `param()`, so derive the
    // remainder from the raw request path (un-encoded) and decode it ourselves.
    const base = `/projects/${slug}/storybook/build/${buildId}/`;
    if (!c.req.path.startsWith(base)) {
      return c.notFound();
    }
    let rest: string;
    try {
      rest = decodeURIComponent(c.req.path.slice(base.length));
    } catch {
      return c.notFound();
    }
    const project = await new ProjectModel(getStore().db, { projects }).getBySlug(slug);
    if (!project) {
      notFound("Project not found");
    }
    const build = await new BuildModel(getStore().db, { builds, buildLabels, snapshots }).get(
      buildId,
    );
    if (!build || build.projectId !== project.id) {
      notFound("Build not found");
    }
    if (!(await canViewBuild(build, project))) {
      return c.redirect("/auth/login", 302);
    }

    if (rest === "") {
      if (!(await staticsReady(project.id, build.id))) {
        return c.html(renderStorybookPreparingPage(project, build, slug), 200);
      }
      return c.html(renderStorybookPage(project, build, slug), 200);
    }

    const segments = rest.split("/");
    if (segments.some((segment) => !isSafeSegment(segment))) {
      return c.notFound();
    }
    const path = posix.join(storybookDir(project.id, build.id), rest);
    if (!(await getStore().storage.exists(path))) {
      return c.notFound();
    }
    const buffer = await getStore().storage.read(path);
    return c.body(new Uint8Array(buffer), 200, {
      "content-type": contentTypeFor(rest),
      "cache-control": "public, max-age=3600",
    });
  });
}
