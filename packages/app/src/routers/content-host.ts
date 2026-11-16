/**
 * Content hosts and alias hosts (ADR 0051, decision 5), reached through `hostDispatch` when a request's
 * `Host` is not the portal. A content host `<build-id>.<baseDomain>` serves one exact build's files and
 * nothing else: no portal page, no API, no other build, no `/_r/`. It sends no sandbox header (its
 * isolation is the separate origin, the grant cookie and the request rules of decision 9).
 *
 * - **Public build** (or an instance without sign-in): the files, with CORS `*`.
 * - **Private build**: the host-only grant cookie, sealed for this build and re-checked on every
 *   request. Without it a navigation is sent to the portal to be authorized; any other request gets
 *   the identical 404. Answers carry `Cross-Origin-Resource-Policy: same-origin`.
 * - **`/_x/<token>/<rest>`**: the exchange. A navigation with a valid `exchange` token for this host's
 *   build sets the cookie and redirects to the clean URL.
 *
 * The alias host `<project-slug>.<baseDomain>` resolves nothing itself: every path redirects to the
 * portal's `/projects/<slug>/storybook`, so the portal's not-found rules (#497) apply there.
 */
import { portalOriginOf, type HostingOrigins } from "@storyshelf/core/config";
import { BuildModel, ProjectModel } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import {
  STORYBOOK_EXCHANGE_PREFIX,
  storybookExchangePath,
  verifyStorybookToken,
} from "@storyshelf/core/utils";
import type { Context } from "hono";
import { getStore } from "../store.ts";
import { grantCookieLine, readGrantCookie } from "./content-grants.ts";
import { encodedRelativePath } from "./content-redirect.ts";
import { isNavigation } from "./fetch-metadata.ts";
import {
  isAnonymouslyViewable,
  publishedAccess,
  type PublishedAccess,
} from "./published-access.ts";
import {
  applySignedUrlHeaders,
  publishedRelativePath,
  refuseToken,
  servePublishedFile,
} from "./published-files.ts";

/** The answer for a host that is none of the portal, a content host or an alias host. */
export function refuseHost(c: Context): Response {
  return refuseToken(c, "unknown host");
}

/** Only reads are answered on a content or alias host. */
function isRead(c: Context): boolean {
  return c.req.method === "GET" || c.req.method === "HEAD";
}

/** A build and its project, as a content host serves them. */
interface HostedBuild {
  project: Project;
  build: Build;
}

/** Serve a request for `<build-id>.<baseDomain>`. */
export async function serveContentHost(
  c: Context,
  origins: HostingOrigins,
  buildId: string,
): Promise<Response> {
  if (!isRead(c)) {
    return refuseToken(c, "method");
  }
  const hosted = await hostedBuild(buildId);
  if (hosted === null) {
    return refuseToken(c, "unknown build");
  }
  return c.req.path.startsWith(STORYBOOK_EXCHANGE_PREFIX)
    ? await exchange(c, hosted)
    : await serveBuildFile(c, origins, hosted);
}

async function hostedBuild(buildId: string): Promise<HostedBuild | null> {
  const { db } = getStore();
  const build = await new BuildModel(db).get(buildId);
  const project = build ? await new ProjectModel(db).get(build.projectId) : null;
  return build && project ? { project, build } : null;
}

/** One file of the host's own build, or the bounce to the portal for a private build without a grant. */
async function serveBuildFile(
  c: Context,
  origins: HostingOrigins,
  hosted: HostedBuild,
): Promise<Response> {
  const { project, build } = hosted;
  const access = await contentAccess(c, project, build);
  if (access === null) {
    return bounceToPortal(c, origins, build);
  }
  const rel = publishedRelativePath(c.req.path, "/");
  if (rel === null) {
    return refuseToken(c, "bad path");
  }
  const served = await servePublishedFile(c, {
    projectId: project.id,
    buildId: build.id,
    rel: rel === "" ? "index.html" : rel,
    access,
    family: "content",
    freshness: "immutable",
  });
  return served ?? refuseToken(c, "no such file");
}

/**
 * How this request may read the build: `public` for an open build, `session` for a private build with a
 * valid grant cookie of this very build (the cookie of another build, or one sealed for another
 * project, is a plain miss), `null` otherwise.
 */
async function contentAccess(
  c: Context,
  project: Project,
  build: Build,
): Promise<PublishedAccess | null> {
  if (isAnonymouslyViewable(build, project)) {
    return "public";
  }
  const grant = readGrantCookie(c.req.header("cookie"));
  if (grant === null || grant.buildId !== build.id) {
    return null;
  }
  return (await publishedAccess(build, project, grant)) === "token" ? "session" : null;
}

/**
 * A private build without a valid cookie: a navigation goes to the portal to be authorized (the short
 * link, which answers a viewer with no role as it answers a missing build and does not name the
 * project); anything else is the identical 404.
 */
function bounceToPortal(c: Context, origins: HostingOrigins, build: Build): Response {
  if (!isNavigation(c)) {
    return refuseToken(c, "no grant");
  }
  const path = encodedRelativePath(publishedRelativePath(c.req.path, "/") ?? "");
  applySignedUrlHeaders(c);
  return c.redirect(
    `${portalOriginOf(origins)}/_/${build.id}/${path}${new URL(c.req.url).search}`,
    302,
  );
}

/**
 * `/_x/<token>/<rest>`: navigations only, an `exchange` token whose build is this host's, and a build
 * the token still opens. The cookie is host-only; the redirect goes to the clean path on this host.
 */
async function exchange(c: Context, hosted: HostedBuild): Promise<Response> {
  const token = c.req.path.split("/")[2] ?? "";
  const rel = publishedRelativePath(c.req.path, storybookExchangePath(token));
  const refusal = rel === null ? "bad path" : await exchangeRefusal(c, token, hosted);
  const cookie = refusal === null ? grantCookieLine(hosted.project, hosted.build) : null;
  if (rel === null || refusal !== null || cookie === null) {
    return refuseToken(c, refusal ?? "no secret");
  }
  applySignedUrlHeaders(c);
  c.header("set-cookie", cookie);
  return c.redirect(`/${encodedRelativePath(rel)}${new URL(c.req.url).search}`, 302);
}

/** Why the exchange is refused (for the debug log only), or null when it may proceed. */
async function exchangeRefusal(
  c: Context,
  token: string,
  hosted: HostedBuild,
): Promise<string | null> {
  if (!isNavigation(c)) {
    return "not a navigation";
  }
  const verified = verifyStorybookToken(token, getStore().config.secret ?? "", "exchange");
  if (!verified.ok) {
    return verified.reason;
  }
  const { project, build } = hosted;
  const opens = (await publishedAccess(build, project, verified.claims)) === "token";
  return opens && verified.claims.buildId === build.id ? null : "exchange for another build";
}

/**
 * Serve a request for `<project-slug>.<baseDomain>`: a redirect to the portal's project Storybook. The
 * query is kept (a `?path=/story/<id>` deep link still opens its story); the path is not, because the
 * alias names a project, not a build's file.
 */
export function serveAliasHost(c: Context, origins: HostingOrigins, slug: string): Response {
  if (!isRead(c)) {
    return refuseToken(c, "method");
  }
  c.header("cache-control", "no-store");
  return c.redirect(
    `${portalOriginOf(origins)}/projects/${encodeURIComponent(slug)}/storybook${new URL(c.req.url).search}`,
    302,
  );
}
