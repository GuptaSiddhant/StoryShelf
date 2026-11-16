/**
 * The root a component page's preview frame loads a build's Storybook from (ADR 0006, decision 9).
 * A sandboxed frame has no cookies, so only a URL that needs none works in it: the build's own URL
 * when anyone who reaches the app may open it, otherwise a `/_r/<token>` read grant minted for a
 * viewer who already has access (ADR 0051, decision 8; needs a `secret`, not `testing`).
 */
import { contentHostSuffix } from "@storyshelf/core/config";
import type { Build, Project } from "@storyshelf/core/schema";
import { createUrlBuilder } from "@storyshelf/core/urls";
import { STORYBOOK_READ_PREFIX } from "@storyshelf/core/utils";
import { getStore } from "../store.ts";
import { hostingMode, isAnonymouslyViewable, publishedAccess } from "./published-access.ts";
import { mintReadGrant } from "./read-grant-token.ts";

/** Lifetime of the token in a page: long enough to open the frame, short enough to be harmless. */
export const PREVIEW_TOKEN_TTL = 3600;

/**
 * How often a page asks for a fresh frame token (seconds): well inside {@link PREVIEW_TOKEN_TTL},
 * so a frame on a page left open never holds an expired token. The token stays short-lived.
 */
export const PREVIEW_TOKEN_REFRESH = 2400;

/** Whether a frame root is a `/_r/<token>` read grant, the only kind that expires. */
export function isSignedPreviewBase(base: string): boolean {
  return base.startsWith(STORYBOOK_READ_PREFIX);
}

/** The frame's root URL (no trailing slash), or null when this viewer cannot be given one. */
export async function previewBaseOf(project: Project, build: Build): Promise<string | null> {
  const { config } = getStore();
  if (isAnonymouslyViewable(build, project)) {
    return createUrlBuilder("/", contentHostSuffix(config)).storybookBuild(project.slug, build.id);
  }
  if (!(await publishedAccess(build, project)) || hostingMode() === "subdomain") {
    // In `subdomain` mode a private build opens on its content host in a new tab: an opaque frame
    // sends no cookie, so the exchange cannot work in one (ADR 0051, decision 8).
    return null;
  }
  const token = mintReadGrant(project, build, PREVIEW_TOKEN_TTL);
  return token === null ? null : `${STORYBOOK_READ_PREFIX}${token}`;
}
