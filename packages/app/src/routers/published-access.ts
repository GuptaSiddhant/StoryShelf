/**
 * The one policy for reading a build's published files (ADR 0007, decision 5; ADR 0011): a signed
 * token naming the build, or a build anyone may open (public, or an instance without sign-in), or
 * a signed-in viewer of the project. Every route that serves published files asks
 * {@link publishedAccess} and takes its CORS headers from {@link publishedCorsHeaders}.
 */
import { isPublicBuild } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import type { StorybookTokenClaims } from "@storyshelf/core/utils";
import { getStore } from "../store.ts";
import { currentProjectRole } from "./helpers.ts";

/** How a request may read a build: by its token, because the build is open, or by a session. */
export type PublishedAccess = "token" | "public" | "session";

const VIEW_ROLES: ReadonlySet<string> = new Set(["viewer", "developer", "approver", "admin"]);

/**
 * Whether the request may read `build`'s published files, and how. A `grant` (verified claims of a
 * signed URL) decides alone: it opens exactly the build it names and nothing falls through to the
 * other rules, so a token that does not fit answers like a missing one.
 */
export async function publishedAccess(
  build: Pick<Build, "id" | "projectId" | "public" | "gitBranch">,
  project: Project,
  grant?: StorybookTokenClaims,
): Promise<PublishedAccess | null> {
  if (grant) {
    return grant.projectId === project.id &&
      grant.buildId === build.id &&
      build.projectId === project.id
      ? "token"
      : null;
  }
  if (isAnonymouslyViewable(build, project)) {
    return "public";
  }
  const role = await currentProjectRole(project.id);
  return role && VIEW_ROLES.has(role) ? "session" : null;
}

/**
 * For a caller with no role on `project`, signed in or not, the answer is the one for a project
 * that does not exist, whatever else the route would say (a missing build, no access): the
 * project's existence is not theirs to learn (#497). An instance without sign-in hides nothing.
 */
export async function hiddenFrom(project: Project): Promise<boolean> {
  return getStore().authEnabled && (await currentProjectRole(project.id)) === null;
}

/**
 * Whether anyone who can reach the app may fetch the build's published Storybook with no
 * credentials: the instance has no sign-in, or the build is public (ADR 0011).
 */
export function isAnonymouslyViewable(
  build: Pick<Build, "public" | "gitBranch">,
  project: Project,
): boolean {
  return !getStore().authEnabled || isPublicBuild(project, build);
}

/**
 * CORS headers of a published file. A sandboxed preview frame runs on an opaque origin, so its
 * module scripts are cross-origin requests without cookies: they load only when the file answers
 * `Access-Control-Allow-Origin: *`. That is offered exactly where no credentials are involved, for
 * a public build and for a signed URL (which is itself the credential, never sent as a cookie or
 * header, and never with `Allow-Credentials`). A signed-in viewer's private build answers without
 * it: only same-origin pages may read it.
 */
/**
 * How long a normal (not signed) published answer may be kept:
 * `immutable` for a file whose URL names its content, `minute` and `hour` for a slug short link that
 * follows the latest build, and `page` for an HTML page that carries build state and must be
 * revalidated.
 */
export type PublishedFreshness = "immutable" | "minute" | "hour" | "page";

const FRESHNESS: Record<PublishedFreshness, string> = {
  immutable: "max-age=31536000, immutable",
  minute: "max-age=60",
  hour: "max-age=3600",
  page: "no-cache",
};

/**
 * `Cache-Control` of a normal published answer, from who may read it. A `public` answer may be kept
 * by a shared cache. A `session` answer is one viewer's private build, so only that viewer's browser
 * may keep it: a shared cache that stored it would serve it to anyone (#923). A signed URL never
 * comes here; `signedCacheControl` decides its answer, and anything that is not `public` is private.
 */
export function publishedCacheControl(
  access: PublishedAccess,
  freshness: PublishedFreshness,
): string {
  return `${access === "public" ? "public" : "private"}, ${FRESHNESS[freshness]}`;
}

export function publishedCorsHeaders(access: PublishedAccess): Record<string, string> {
  return access === "session" ? {} : { "access-control-allow-origin": "*" };
}
