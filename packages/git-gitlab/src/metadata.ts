import { gitlabConfigSchema } from "./config.ts";

import type { GitHostProvider } from "@storyshelf/core";

declare const __PKG_VERSION__: string;

export function getMetadata(): GitHostProvider["metadata"] {
  return {
    name: "GitLab",
    version: typeof __PKG_VERSION__ === "undefined" ? "0.0.0" : __PKG_VERSION__, // oxlint-disable-line unicorn/no-typeof-undefined
    description: "Commit statuses via GitLab API",
    kind: "gitlab",
    logo: "gitlab",
    schema: gitlabConfigSchema,
  };
}
