import type { DesignProvider } from "@storyshelf/core/adapter/design";
import { createFigmaClient } from "./api.ts";
import { getMetadata } from "./metadata.ts";
import { createFigmaOAuth, type FigmaOAuthOptions } from "./oauth.ts";
import { parseFigmaUrl } from "./url.ts";

/** Options of {@link createFigmaDesign}. */
export interface FigmaDesignOptions {
  /** Registered Figma OAuth app: lets members connect their own account when the project has no token. */
  oauth?: FigmaOAuthOptions;
}

/** Figma design provider for StoryShelf: pass it as `design: [createFigmaDesign()]`. */
export function createFigmaDesign(options: FigmaDesignOptions = {}): DesignProvider {
  return {
    metadata: getMetadata(),
    parseUrl: parseFigmaUrl,
    create: ({ credential, authType }) => createFigmaClient(credential, authType),
    ...(options.oauth ? { oauth: createFigmaOAuth(options.oauth) } : {}),
  };
}

export { createFigmaClient, fetchFigmaMetas, fetchFigmaRenders } from "./api.ts";
export { createFigmaOAuth, figmaOAuthFromEnv, type FigmaOAuthOptions } from "./oauth.ts";
export { parseFigmaUrl } from "./url.ts";
