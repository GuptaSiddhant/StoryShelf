import type { GitHostProvider } from "@storyshelf/core";
import { gitlabConfigSchema } from "./config.ts";

declare const __PKG_VERSION__: string | undefined;

/** Describe the GitLab provider (name, version, config schema). */
export function getMetadata(): GitHostProvider["metadata"] {
  return {
    name: "GitLab",
    version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
    description: "Commit statuses via GitLab API",
    kind: "gitlab",
    logo: "gitlab",
    schema: gitlabConfigSchema,
  };
}
