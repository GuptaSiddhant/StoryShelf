import { githubConfigSchema } from "./config.ts";

import type { GitHostProvider } from "@storyshelf/core";

declare const __PKG_VERSION__: string | undefined;

export function getMetadata(): GitHostProvider["metadata"] {
  return {
    name: "GitHub",
    version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
    description: "Commit statuses via GitHub REST API",
    kind: "github",
    logo: "github",
    schema: githubConfigSchema,
  };
}
