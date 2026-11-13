/** Handlers of the published Storybook resolver and static-asset routes (composed by `storybook.ts`). */
import { BuildModel, LabelModel, ProjectModel } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import { storybookDir } from "@storyshelf/core/utils";
import type { Context } from "hono";
import { posix } from "node:path";
import { renderStorybookPage, renderStorybookPreparingPage } from "../pages/storybook.tsx";
import { getStore } from "../store.ts";
import { redirectToContentHost } from "./content-redirect.ts";
import { notFound } from "./helpers.ts";
import {
  hiddenFrom,
  hostingMode,
  publishedAccess,
  publishedCacheControl,
  type PublishedFreshness,
} from "./published-access.ts";
import { publishedRelativePath, servePublishedFile } from "./published-files.ts";
import { redirectToReadGrant } from "./read-grants.ts";

type Access = NonNullable<Awaited<ReturnType<typeof publishedAccess>>>;

/** A short link resolved to its build, with the caller's access and the path inside the build. */
type ShortLink = { project: Project; build: Build; access: Access; isUlid: boolean; rest: string };

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

/** Whether a short-link id names one build (a 26-character ULID) rather than a project slug. */
function isBuildId(id: string): boolean {
  return id.length === 26 && /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(id);
}

/**
 * The build a short link opens: the build itself for a ULID, whatever its status; for a project
 * slug the latest approved build on the default branch (never a feature branch or an unreviewed
 * build). Null when nothing matches.
 */
async function resolveShortLink(id: string): Promise<{ project: Project; build: Build } | null> {
  const { db } = getStore();
  if (isBuildId(id)) {
    const build = await new BuildModel(db).get(id);
    const project = build ? await new ProjectModel(db).get(build.projectId) : null;
    return build && project ? { project, build } : null;
  }
  const project = await new ProjectModel(db).getBySlug(id);
  const build = project ? await new BuildModel(db).latestApprovedDefault(project) : null;
  return project && build ? { project, build } : null;
}

/**
 * The answer for a short link that names nothing: the plain 404. A private build or project
 * answers the same to a caller with no role (see `hiddenFrom`), so a link never confirms that a
 * private id exists (#497).
 */
function unreachable(c: Context): Response | Promise<Response> {
  return c.notFound();
}

/** Freshness of the short link: a ULID names one build forever; a slug follows the latest. */
function shortLinkFreshness(isUlid26: boolean, isRoot: boolean): PublishedFreshness {
  if (isUlid26) {
    return "immutable";
  }
  return isRoot ? "minute" : "hour";
}

async function projectBySlug(slug: string): Promise<Project> {
  const project = await new ProjectModel(getStore().db).getBySlug(slug);
  if (!project) {
    notFound("Project not found");
  }
  return project;
}

/** The answer for a caller without access: a hidden project looks missing, otherwise sign in. */
function denied(c: Context, hidden: boolean): Response {
  return hidden ? notFound("Project not found") : c.redirect("/auth/login", 302);
}

/** Resolver: latest approved build on the default branch (never feature branches). */
export async function redirectToLatestBuild(c: Context): Promise<Response> {
  const slug = c.req.param("slug") ?? "";
  const project = await projectBySlug(slug);
  const hidden = await hiddenFrom(project);
  const build = await new BuildModel(getStore().db).latestApprovedDefault(project);
  if (!build) {
    notFound(hidden ? "Project not found" : "No approved build on the default branch yet");
  }
  if (!(await publishedAccess(build, project))) {
    return denied(c, hidden);
  }
  return c.redirect(`/projects/${slug}/storybook/build/${build.id}/${searchOf(c)}`, 302);
}

/**
 * The request's query, kept through a resolver hop so a deep link (`?path=/story/<id>`,
 * `?storyId=<id>`) still opens its story once it reaches the build. Re-serialized by `URL`, so it
 * stays a query: it can never become a path, a host or a header.
 */
function searchOf(c: Context): string {
  return new URL(c.req.url).search;
}

/**
 * Short link `/_/:id/*`: a 26-char ULID is that exact build, whatever its status (visibility check
 * only); any other id is a project slug → latest approved build on the default branch, else 404
 * (no fallback to feature-branch or unreviewed builds). No fall-through on ULID.
 */
export async function serveShortLink(c: Context): Promise<Response> {
  const id = c.req.param("id") ?? "";
  const rest = publishedRelativePath(c.req.path, `/_/${id}/`);
  if (rest === null) return c.notFound();
  const target = await resolveShortLink(id);
  if (!target) return await unreachable(c);
  const { project, build } = target;
  const access = await publishedAccess(build, project);
  if (!access) {
    // A caller with no role gets what a build that does not exist gets (#497).
    return (await hiddenFrom(project)) ? c.notFound() : c.redirect("/auth/login", 302);
  }
  return await serveShortBuild(c, { project, build, access, isUlid: isBuildId(id), rest });
}

async function serveShortBuild(c: Context, link: ShortLink): Promise<Response> {
  const { project, build, access, isUlid, rest } = link;
  if (rest === "" && !(await staticsReady(project.id, build.id))) {
    return c.html(renderStorybookPreparingPage(project, build, project.slug), 200, {
      "cache-control": publishedCacheControl(access, "page"),
    });
  }
  const served =
    redirectForHosting(c, { project, build, access, rest }) ??
    (await servePublishedFile(c, {
      projectId: project.id,
      buildId: build.id,
      rel: rest === "" ? "index.html" : rest,
      access,
      family: "short",
      freshness: shortLinkFreshness(isUlid, rest === ""),
    }));
  if (served) return served;
  const fallback = isUlid
    ? `/projects/${project.slug}/builds/${build.id}`
    : `/projects/${project.slug}`;
  return rest === "" || rest === "index.html" ? c.redirect(fallback, 302) : c.notFound();
}

/**
 * The redirect that replaces serving a build's bytes from the portal, or null when the portal serves
 * them: `subdomain` mode sends every viewer to the build's content host, `sandboxed` mode sends a
 * signed-in viewer of a private build to a read grant (a sandboxed frame sends no cookie). ADR 0051.
 */
function redirectForHosting(
  c: Context,
  target: { project: Project; build: Build; access: Access; rest: string },
): Response | null {
  const mode = hostingMode();
  if (mode === "subdomain") {
    return redirectToContentHost(c, target);
  }
  if (mode === "sandboxed" && target.access === "session") {
    return redirectToReadGrant(c, target.project, target.build, target.rest);
  }
  return null;
}

/** Canonical build route: serves the static Storybook and the landing page. */
export async function serveBuildStorybook(c: Context): Promise<Response> {
  const slug = c.req.param("slug") ?? "";
  const buildId = c.req.param("buildId") ?? "";
  // Hono's bare `/*` wildcard is not exposed through `param()`, so derive the
  // remainder from the raw request path (un-encoded) and decode it ourselves.
  const rest = publishedRelativePath(c.req.path, `/projects/${slug}/storybook/build/${buildId}/`);
  if (rest === null) {
    return c.notFound();
  }
  return await serveBuild(c, slug, buildId, rest);
}

async function buildOf(project: Project, buildId: string, hidden: boolean): Promise<Build> {
  const build = await new BuildModel(getStore().db).get(buildId);
  if (!build || build.projectId !== project.id) {
    notFound(hidden ? "Project not found" : "Build not found");
  }
  return build;
}

async function serveBuild(
  c: Context,
  slug: string,
  buildId: string,
  rest: string,
): Promise<Response> {
  const project = await projectBySlug(slug);
  const hidden = await hiddenFrom(project);
  const build = await buildOf(project, buildId, hidden);
  const access = await publishedAccess(build, project);
  if (!access) {
    return denied(c, hidden);
  }
  if (rest === "") {
    return await storybookLanding(c, project, build, access);
  }
  return await serveBuildFile(c, { project, build, access, rest });
}

/** A file of the canonical path: a read-grant redirect in `sandboxed` mode, otherwise the file. */
async function serveBuildFile(
  c: Context,
  target: { project: Project; build: Build; access: Access; rest: string },
): Promise<Response> {
  const { project, build, access, rest } = target;
  const redirect = redirectForHosting(c, target);
  if (redirect) {
    return redirect;
  }
  const served = await servePublishedFile(c, {
    projectId: project.id,
    buildId: build.id,
    rel: rest,
    access,
    family: "project",
    freshness: "immutable",
  });
  return served ?? c.notFound();
}

/**
 * The query the build's own manager reads for a `?storyId=` / `?viewMode=docs` link (the portal's
 * copy-link form): `?path=/story/<id>` or `?path=/docs/<id>`. `undefined` keeps the request's query.
 */
function managerSearch(c: Context): string | undefined {
  const id = c.req.query("storyId")?.trim() ?? "";
  if (id === "" || !/^[a-zA-Z0-9._/-]+$/u.test(id)) {
    return undefined;
  }
  const view = c.req.query("viewMode") === "docs" ? "docs" : "story";
  return `?path=${encodeURIComponent(`/${view}/${id}`)}`;
}

async function storybookLanding(
  c: Context,
  project: Project,
  build: Build,
  access: Access,
): Promise<Response> {
  const headers = { "cache-control": publishedCacheControl(access, "page") };
  if (!(await staticsReady(project.id, build.id))) {
    return c.html(renderStorybookPreparingPage(project, build, project.slug), 200, headers);
  }
  if (hostingMode() === "subdomain") {
    return redirectToContentHost(c, {
      project,
      build,
      access,
      rest: "",
      search: managerSearch(c),
    });
  }
  const storyId = c.req.query("storyId") ?? c.req.query("id") ?? undefined;
  const viewMode = c.req.query("viewMode") === "docs" ? "docs" : undefined;
  return c.html(
    renderStorybookPage(project, build, project.slug, { storyId, viewMode }),
    200,
    headers,
  );
}

/** The label value in `/projects/:slug/storybook/:key/<value>`, or null when absent or malformed. */
function labelValue(path: string): string | null {
  try {
    return decodeURIComponent(path.split("/").slice(5).join("/")) || null;
  } catch {
    return null;
  }
}

async function latestLabelBuildId(
  project: Project,
  key: string,
  value: string,
  hidden: boolean,
): Promise<string> {
  const buildId = await new LabelModel(getStore().db).latestBuildId(project.id, key, value);
  if (!buildId) {
    notFound(hidden ? "Project not found" : "No build carries that label");
  }
  return buildId;
}

/** Resolver: latest build bearing a label (`build` is a reserved label key). */
export async function redirectToLabelBuild(c: Context): Promise<Response> {
  const slug = c.req.param("slug") ?? "";
  const key = c.req.param("key") ?? "";
  const value = labelValue(c.req.path);
  if (key === "build" || !value) {
    return c.notFound();
  }
  const project = await projectBySlug(slug);
  const hidden = await hiddenFrom(project);
  const buildId = await latestLabelBuildId(project, key, value, hidden);
  return await labelRedirect(c, project, hidden, buildId);
}

async function labelRedirect(
  c: Context,
  project: Project,
  hidden: boolean,
  buildId: string,
): Promise<Response> {
  const build = await new BuildModel(getStore().db).get(buildId);
  if (!build || !(await publishedAccess(build, project))) {
    return denied(c, hidden);
  }
  return c.redirect(`/projects/${project.slug}/storybook/build/${buildId}/${searchOf(c)}`, 302);
}
