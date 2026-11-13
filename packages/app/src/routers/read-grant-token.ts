/**
 * Minting a read grant (ADR 0051, decision 4). A leaf module on purpose: pages import it through
 * `preview-base.ts`, and the app's Storybook must not pull the file-serving code behind `/_r/` along.
 */
import type { Build, Project } from "@storyshelf/core/schema";
import { signStorybookToken } from "@storyshelf/core/utils";
import { getStore } from "../store.ts";

/** A read grant for `build`, or null when the server has no secret to sign it with. */
export function mintReadGrant(project: Project, build: Build, ttlSeconds?: number): string | null {
  const { secret } = getStore().config;
  return secret
    ? signStorybookToken({
        secret,
        projectId: project.id,
        buildId: build.id,
        purpose: "read",
        ttlSeconds,
      })
    : null;
}
