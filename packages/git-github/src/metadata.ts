import { githubConfigSchema } from "./config.ts";

import type { GitHostProvider } from "@storyshelf/core";

declare const __PKG_VERSION__: string;

export function getMetadata(): GitHostProvider["metadata"] {
  return {
    name: "GitHub",
    version: typeof __PKG_VERSION__ === "undefined" ? "0.0.0" : __PKG_VERSION__, // oxlint-disable-line unicorn/no-typeof-undefined
    description: "Commit statuses via GitHub REST API",
    kind: "github",
    logo: "github",
    schema: githubConfigSchema,
  };
}
