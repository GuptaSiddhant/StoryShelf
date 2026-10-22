import { BuildModel } from "@storyshelf/core/models";
import { LabelModel } from "@storyshelf/core/models";
import { ProjectModel } from "@storyshelf/core/models";
import type { Build } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import { storybookDir } from "@storyshelf/core/utils";
import { posix } from "node:path";
import type { ShelfRouter } from "../app-types.ts";
import { renderStorybookPage, renderStorybookPreparingPage } from "../pages/storybook.tsx";
import { getStore } from "../store.ts";
import { notFound } from "./helpers.ts";
import { publishedAccess } from "./published-access.ts";
import { publishedRelativePath, servePublishedFile } from "./published-files.ts";

/** Check whether a build's extracted statics are available for serving. */
async function staticsReady(projectId: string, buildId: string): Promise<boolean> {
  // New path: manifest.json indicates content-addressed storage; fallback to legacy iframe.html
  if (
    await getStore().storage.exists(posix.join(storybookDir(projectId, buildId), "manifest.json"))
  ) {
    return true;
  }
  return await getStore().storage.exists(
    posix.join(storybookDir(projectId, buildId), "iframe.html"),
  );
}

/** Register the published Storybook resolver and static-asset routes. */
export function registerStorybook(app: ShelfRouter): void {
  app.get("/_", (c) => c.redirect("/", 302));
  app.get("/_/", (c) => c.redirect("/", 302));

  // Resolver: latest approved build on the default branch (never feature branches).
  app.get("/projects/:slug/storybook", async (c) => {
    const slug = c.req.param("slug");
    const project = await new ProjectModel(getStore().db).getBySlug(slug);
    if (!project) {
      notFound("Project not found");
    }
    const build = await new BuildModel(getStore().db).latestApprovedDefault(project);
    if (!build) {
      notFound("No approved build on the default branch yet");
    }
    if (!(await publishedAccess(build, project))) {
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
    const project = await new ProjectModel(getStore().db).getBySlug(slug);
    if (!project) {
      notFound("Project not found");
    }
    const buildId = await new LabelModel(getStore().db).latestBuildId(project.id, key, value);
    if (!buildId) {
      notFound("No build carries that label");
    }
    const build = await new BuildModel(getStore().db).get(buildId);
    if (!build || !(await publishedAccess(build, project))) {
      return c.redirect("/auth/login", 302);
    }
    return c.redirect(`/projects/${slug}/storybook/build/${buildId}/`, 302);
  });

  // Short link canonical is /_/:id/ with trailing slash (so relative ./sb-manager/... resolves).
  // 26-char ULID → that exact build, whatever its status (visibility check only).
  // Any other id → project slug → latest approved build on the default branch, else 404
  // (no fallback to feature-branch or unreviewed builds). No fall-through on ULID.
  app.get("/_/:id", async (c) => {
    const id = c.req.param("id");
    const isUlid26 = id.length === 26 && /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(id);
    if (isUlid26) {
      const build = await new BuildModel(getStore().db).get(id);
      if (!build) notFound();
    } else {
      const project = await new ProjectModel(getStore().db).getBySlug(id);
      if (!project) notFound();
    }
    return c.redirect(`/_/${id}/`, 302);
  });

  app.get("/_/:id/*", async (c) => {
    const id = c.req.param("id");
    const isUlid26 = id.length === 26 && /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(id);
    const rest = publishedRelativePath(c.req.path, `/_/${id}/`);
    if (rest === null) return c.notFound();
    let project: Project | null = null;
    let build: Build | null = null;
    if (isUlid26) {
      build = await new BuildModel(getStore().db).get(id);
      if (!build) return c.notFound();
      project = await new ProjectModel(getStore().db).get(build.projectId);
      if (!project) return c.notFound();
    } else {
      project = await new ProjectModel(getStore().db).getBySlug(id);
      if (!project) return c.notFound();
      build = await new BuildModel(getStore().db).latestApprovedDefault(project);
      if (!build) return c.notFound();
    }
    const access = await publishedAccess(build, project);
    if (!access) return c.redirect("/auth/login", 302);
    if (rest === "" && !(await staticsReady(project.id, build.id))) {
      return c.html(renderStorybookPreparingPage(project, build, project.slug), 200);
    }
    const fallback = isUlid26
      ? `/projects/${project.slug}/builds/${build.id}`
      : `/projects/${project.slug}`;
    const served = await servePublishedFile(c, {
      projectId: project.id,
      buildId: build.id,
      rel: rest === "" ? "index.html" : rest,
      access,
      cacheControl: shortLinkCache(isUlid26, rest === ""),
    });
    if (served) return served;
    return rest === "" || rest === "index.html" ? c.redirect(fallback, 302) : c.notFound();
  });

  // Canonical build route: serves the static Storybook and the landing page.
  app.get("/projects/:slug/storybook/build/:buildId/*", async (c) => {
    const slug = c.req.param("slug");
    const buildId = c.req.param("buildId");
    // Hono's bare `/*` wildcard is not exposed through `param()`, so derive the
    // remainder from the raw request path (un-encoded) and decode it ourselves.
    const rest = publishedRelativePath(c.req.path, `/projects/${slug}/storybook/build/${buildId}/`);
    if (rest === null) {
      return c.notFound();
    }
    const project = await new ProjectModel(getStore().db).getBySlug(slug);
    if (!project) {
      notFound("Project not found");
    }
    const build = await new BuildModel(getStore().db).get(buildId);
    if (!build || build.projectId !== project.id) {
      notFound("Build not found");
    }
    const access = await publishedAccess(build, project);
    if (!access) {
      return c.redirect("/auth/login", 302);
    }

    if (rest === "") {
      if (!(await staticsReady(project.id, build.id))) {
        return c.html(renderStorybookPreparingPage(project, build, slug), 200);
      }
      const storyId = c.req.query("storyId") ?? c.req.query("id") ?? undefined;
      const viewMode = c.req.query("viewMode") === "docs" ? "docs" : undefined;
      return c.html(renderStorybookPage(project, build, slug, { storyId, viewMode }), 200);
    }

    return (
      (await servePublishedFile(c, {
        projectId: project.id,
        buildId: build.id,
        rel: rest,
        access,
        cacheControl: "public, max-age=31536000, immutable",
      })) ?? c.notFound()
    );
  });
}

/** Cache policy of the short link: a ULID names one build forever; a slug follows the latest. */
function shortLinkCache(isUlid26: boolean, isRoot: boolean): string {
  if (isUlid26) {
    return "public, max-age=31536000, immutable";
  }
  return isRoot ? "public, max-age=60" : "public, max-age=3600";
}
