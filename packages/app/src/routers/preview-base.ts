/**
 * The root a component page's preview frame loads a build's Storybook from (ADR 0006, decision 9).
 * A sandboxed frame has no cookies, so only a URL that needs none works in it: the build's own URL
 * when anyone who reaches the app may open it, otherwise a signed `/_s/<token>` URL minted for a
 * viewer who already has access (ADR 0007, decision 5; needs `testing` and a `secret`).
 */
import type { Build, Project } from "@storyshelf/core/schema";
import { createUrlBuilder } from "@storyshelf/core/urls";
import {
  signStorybookToken,
  STORYBOOK_TOKEN_PREFIX,
  type SecretInput,
} from "@storyshelf/core/utils";
import { credentialKeys } from "../credential-keys.ts";
import { getStore, testingEnabled } from "../store.ts";
import { isAnonymouslyViewable, publishedAccess } from "./published-access.ts";

/** Lifetime of the token in a page: long enough to open the frame, short enough to be harmless. */
export const PREVIEW_TOKEN_TTL = 3600;

/** The frame's root URL (no trailing slash), or null when this viewer cannot be given one. */
export async function previewBaseOf(project: Project, build: Build): Promise<string | null> {
  const { config } = getStore();
  if (isAnonymouslyViewable(build, project)) {
    return createUrlBuilder("/", config.publishedBaseDomain).storybookBuild(project.slug, build.id);
  }
  const secret: SecretInput = credentialKeys(config);
  if (!testingEnabled() || !secret || !(await publishedAccess(build, project))) {
    return null;
  }
  const token = signStorybookToken({
    secret,
    projectId: project.id,
    buildId: build.id,
    ttlSeconds: PREVIEW_TOKEN_TTL,
  });
  return `${STORYBOOK_TOKEN_PREFIX}${token}`;
}
