import { gitlabConfigSchema } from "./config.ts";

import type { GitHostProvider } from "@storyshelf/core";

declare const __PKG_VERSION__: string | undefined;

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
