import type { GitHostProvider } from "@storyshelf/core";
import { githubConfigSchema } from "./config.ts";

declare const __PKG_VERSION__: string | undefined;

/** Describe the GitHub provider (name, version, config schema). */
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
