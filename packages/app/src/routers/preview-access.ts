import { isPublicBuild } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import { getStore } from "../store.ts";

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
 * Response headers of a build's published files. A sandboxed preview frame runs on an opaque
 * origin, so its module scripts are cross-origin requests that carry no cookies: they load only
 * when the file answers `Access-Control-Allow-Origin: *`, which is offered exactly where no
 * credentials are needed. Private builds under sign-in answer without it and cannot be embedded.
 */
export function previewCorsHeaders(
  build: Pick<Build, "public" | "gitBranch">,
  project: Project,
): Record<string, string> {
  return isAnonymouslyViewable(build, project) ? { "access-control-allow-origin": "*" } : {};
}
