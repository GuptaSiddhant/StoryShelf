/**
 * @deprecated The Figma integration is built into `@storyshelf/core` (ADR 0049) and registered by
 * default; import from `@storyshelf/core/integrations` instead. This package re-exports it for one
 * minor release and is then no longer published.
 */
export {
  createFigmaClient,
  createFigmaDesign,
  createFigmaOAuth,
  fetchFigmaMetas,
  fetchFigmaRenders,
  figmaOAuthFromEnv,
  parseFigmaUrl,
  type FigmaDesignOptions,
  type FigmaOAuthOptions,
} from "@storyshelf/core/integrations";
