import type { DesignProvider } from "@storyshelf/core/adapter/design";
import { createFigmaClient } from "./api.ts";
import { getMetadata } from "./metadata.ts";
import { parseFigmaUrl } from "./url.ts";

/** Figma design provider for StoryShelf: pass it as `design: [createFigmaDesign()]`. */
export function createFigmaDesign(): DesignProvider {
  return {
    metadata: getMetadata(),
    parseUrl: parseFigmaUrl,
    create: ({ credential }) => createFigmaClient(credential),
  };
}

export { createFigmaClient, fetchFigmaMetas, fetchFigmaRenders } from "./api.ts";
export { parseFigmaUrl } from "./url.ts";
