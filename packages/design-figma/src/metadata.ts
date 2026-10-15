import type { DesignProvider } from "@storyshelf/core/adapter/design";

declare const __PKG_VERSION__: string | undefined;

/** Describe the Figma provider (name, version, credential copy). */
export function getMetadata(): DesignProvider["metadata"] {
  return {
    name: "Figma",
    version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
    description: "Figma links, file metadata and rendered previews via the Figma REST API",
    kind: "figma",
    category: "design",
    credentialLabel: "Figma access token",
    credentialHelp:
      "A personal access token with read access (file content) lets StoryShelf show the design name and flag stale designs. Without one, buttons still deep-link to Figma. Figma tokens expire after at most 90 days — rotate before then.",
    credentialPlaceholder: "figd_…",
    urlHint: "https://www.figma.com/design/<file>?node-id=1-2",
    credentialMaxAgeDays: 90,
  };
}
