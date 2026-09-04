import { posix } from "node:path";
import type { ShelfApp } from "../index.tsx";
import { isPublicBuild, BuildModel } from "../models/build.ts";
import { LabelModel } from "../models/label.ts";
import { ProjectModel } from "../models/project.ts";
import { renderStorybookPage } from "../pages/storybook.tsx";
import type { Build, Project } from "../schema.ts";
import { getStore } from "../store.ts";
import { storybookDir } from "../utils/paths.ts";
import { currentProjectRole, notFound } from "./helpers.ts";

const VIEW_ROLES: ReadonlySet<string> = new Set(["viewer", "developer", "approver", "admin"]);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".wasm": "application/wasm",
};

function contentTypeFor(path: string): string {
  const ext = posix.extname(path).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

function isSafeSegment(segment: string): boolean {
  return (
    segment !== ".." &&
    !segment.startsWith("/") &&
    !segment.includes("\\") &&
    !segment.includes("..")
  );
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

/** Register the published Storybook resolver and static-asset routes. */
export function registerStorybook(app: ShelfApp): void {
  // Resolver: latest published build on the default branch.
  app.get("/projects/:slug/storybook", async (c) => {
    const slug = c.req.param("slug");
    const project = await new ProjectModel(getStore().db).getBySlug(slug);
    if (!project) {
      notFound("Project not found");
    }
    const build = await new BuildModel(getStore().db).latestPublished(project);
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
    const project = await new ProjectModel(getStore().db).getBySlug(slug);
    if (!project) {
      notFound("Project not found");
    }
    const buildId = await new LabelModel(getStore().db).latestBuildId(project.id, key, value);
    if (!buildId) {
      notFound("No build carries that label");
    }
    const build = await new BuildModel(getStore().db).get(buildId);
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
    const project = await new ProjectModel(getStore().db).getBySlug(slug);
    if (!project) {
      notFound("Project not found");
    }
    const build = await new BuildModel(getStore().db).get(buildId);
    if (!build || build.projectId !== project.id) {
      notFound("Build not found");
    }
    if (!(await canViewBuild(build, project))) {
      return c.redirect("/auth/login", 302);
    }

    if (rest === "") {
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
